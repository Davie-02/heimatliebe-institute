import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { EventsService } from "../events/events.service";
import { ActivityService, changedFields, plain, type Actor } from "../activity/activity.service";
import { WebhooksService } from "../integrations/webhooks.service";
import { StudentAuthService } from "../auth/student-auth.service";
import { getResource, RESOURCES, STAFF_PICKER } from "./registry";
import type { FieldDef, ResourceDef } from "./types";
import { validateInput } from "./validate";

type Row = Record<string, unknown>;
type Delegate = {
  findMany: (args: unknown) => Promise<Row[]>;
  findFirst: (args: unknown) => Promise<Row | null>;
  findUnique: (args: unknown) => Promise<Row | null>;
  count: (args: unknown) => Promise<number>;
  create: (args: unknown) => Promise<Row>;
  update: (args: unknown) => Promise<Row>;
  delete: (args: unknown) => Promise<Row>;
};

export interface ListQuery {
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: "asc" | "desc";
  filters?: Record<string, string>;
}

const MAX_PAGE_SIZE = 100;
const EXPORT_LIMIT = 10_000;

/** Converts a filter value from the query string into the column's type. */
function filterValue(field: FieldDef | undefined, value: string): unknown {
  if (value === "null") return null;
  if (field?.type === "bool") return value === "true";
  if (field?.type === "int") return Number.isInteger(Number(value)) ? Number(value) : undefined;
  return value;
}

/** Turns known database errors into messages a person can act on. */
function friendlyError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const target = (error.meta?.target as string[] | undefined)?.join(", ");
      throw new ConflictException(`A record with the same ${target ?? "details"} already exists.`);
    }
    if (error.code === "P2003") throw new BadRequestException("A linked record (for example the student or class) wasn't found.");
    if (error.code === "P2025") throw new NotFoundException("That record no longer exists.");
  }
  throw error;
}

/**
 * Generic list / read / create / update / delete for every resource in registry.ts.
 * Access has already been checked by RolesGuard (see access/route-access.ts); this service checks
 * the data, records who changed what (with undo), tells open screens to refresh, and notifies webhooks.
 */
@Injectable()
export class ResourceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly activity: ActivityService,
    private readonly webhooks: WebhooksService,
    private readonly studentAuth: StudentAuthService
  ) {}

  /** The registry without server-only parts, for building forms and tables in the browser. */
  schema() {
    return RESOURCES.map(({ prepare: _prepare, public: publicRead, ...rest }) => ({
      ...rest,
      canCreate: rest.canCreate !== false,
      canUpdate: rest.canUpdate !== false,
      canDelete: rest.canDelete !== false,
      deleteLevel: rest.deleteLevel ?? "edit",
      isPublic: Boolean(publicRead),
    }));
  }

  resource(key: string): ResourceDef {
    const resource = getResource(key);
    if (!resource) throw new NotFoundException("Unknown kind of record.");
    return resource;
  }

  private delegate(model: string): Delegate {
    return (this.prisma as unknown as Record<string, Delegate>)[model];
  }

  /** Includes each linked record's id and name, so lists can show "Chikondi Banda" instead of an id. */
  private include(resource: ResourceDef): Record<string, unknown> | undefined {
    const include: Record<string, unknown> = {};
    for (const field of resource.fields) {
      if (field.type !== "ref" || !field.relation) continue;
      const target = field.ref === "staff" ? STAFF_PICKER.titleField : getResource(field.ref!)?.titleField ?? "id";
      include[field.relation] = { select: { id: true, [target]: true } };
    }
    return Object.keys(include).length ? include : undefined;
  }

  private where(resource: ResourceDef, query: ListQuery, base: Record<string, unknown> = {}): Record<string, unknown> {
    const and: Record<string, unknown>[] = [base];
    const fields = new Map(resource.fields.map((field) => [field.name, field]));
    for (const [name, value] of Object.entries(query.filters ?? {})) {
      if (!resource.filters?.includes(name) || value === undefined || value === "") continue;
      const converted = filterValue(fields.get(name), value);
      if (converted !== undefined) and.push({ [name]: converted });
    }
    const q = query.q?.trim().slice(0, 100);
    if (q && resource.search?.length) {
      and.push({ OR: resource.search.map((name) => ({ [name]: { contains: q, mode: "insensitive" } })) });
    }
    return { AND: and };
  }

  private orderBy(resource: ResourceDef, query: ListQuery): Record<string, "asc" | "desc">[] {
    const sortable = new Set([...resource.fields.filter((f) => f.type !== "json" && f.type !== "ref").map((f) => f.name), "createdAt"]);
    const field = query.sort && sortable.has(query.sort) ? query.sort : resource.sort?.field ?? "createdAt";
    const dir = query.dir === "asc" || query.dir === "desc" ? query.dir : resource.sort?.dir ?? "desc";
    // The id as a tie-breaker keeps paging stable when many rows share a value.
    return [{ [field]: dir }, { id: "asc" }];
  }

  async list(key: string, query: ListQuery) {
    const resource = this.resource(key);
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 25, 1), MAX_PAGE_SIZE);
    const page = Math.max(Number(query.page) || 1, 1);
    const where = this.where(resource, query);
    const delegate = this.delegate(resource.model);
    const [items, total] = await Promise.all([
      delegate.findMany({ where, orderBy: this.orderBy(resource, query), skip: (page - 1) * pageSize, take: pageSize, include: this.include(resource) }),
      delegate.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(key: string, id: string) {
    const resource = this.resource(key);
    const row = await this.delegate(resource.model).findUnique({ where: { id }, include: this.include(resource) });
    if (!row) throw new NotFoundException(`${resource.singular} not found.`);
    return row;
  }

  /** Id + name pairs for pickers ("choose a student"). */
  async options(key: string, q?: string, ids?: string[]) {
    const isStaff = key === "staff";
    const resource = isStaff ? null : this.resource(key);
    const model = isStaff ? STAFF_PICKER.model : resource!.model;
    const title = isStaff ? STAFF_PICKER.titleField : resource!.titleField;
    const search = isStaff ? ["name", "email"] : resource!.search ?? [title];
    const text = q?.trim().slice(0, 100);
    const where: Record<string, unknown> = {
      ...(isStaff ? { isActive: true } : {}),
      ...(ids?.length ? { id: { in: ids.slice(0, 100) } } : {}),
      ...(text ? { OR: search.map((name) => ({ [name]: { contains: text, mode: "insensitive" } })) } : {}),
    };
    const extra = key === "students" ? { studentNo: true } : {};
    const rows = await this.delegate(model).findMany({ where, select: { id: true, [title]: true, ...extra }, orderBy: { [title]: "asc" }, take: 20 });
    return rows.map((row) => ({ id: row.id as string, label: String(row[title] ?? row.id) + (row.studentNo ? ` (${row.studentNo})` : "") }));
  }

  async create(key: string, body: unknown, actor: Actor & { id: string; name: string }) {
    const resource = this.resource(key);
    if (resource.canCreate === false) throw new BadRequestException(`${resource.label} can't be added here.`);
    const { data, errors } = validateInput(resource, body, "create");
    if (Object.keys(errors).length) throw new BadRequestException({ message: "Please check the highlighted fields.", errors });
    const prepared = resource.prepare ? await resource.prepare(data, "create", { prisma: this.prisma, actor }) : data;

    let row: Row;
    try {
      row = await this.delegate(resource.model).create({ data: prepared });
    } catch (error) {
      friendlyError(error);
    }
    const title = String(row[resource.titleField] ?? "");
    await this.activity.log(actor, "created", `Added ${resource.singular.toLowerCase()} “${title}”`, { type: key, id: row.id as string }, {
      kind: "created",
      model: resource.model,
      id: row.id as string,
      topic: resource.topic ?? key,
    });
    this.afterWrite(resource, `${resource.key}.created`, row);
    // A student added by hand gets the same welcome email as one accepted from an application.
    if (key === "students") return { ...row, invitation: await this.studentAuth.invite(row.id as string) };
    return row;
  }

  async update(key: string, id: string, body: unknown, actor: Actor & { id: string; name: string }) {
    const resource = this.resource(key);
    if (resource.canUpdate === false) throw new BadRequestException(`${resource.label} can't be edited here.`);
    const delegate = this.delegate(resource.model);
    const existing = await delegate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`${resource.singular} not found.`);
    const { data, errors } = validateInput(resource, body, "update");
    if (Object.keys(errors).length) throw new BadRequestException({ message: "Please check the highlighted fields.", errors });
    const prepared = resource.prepare ? await resource.prepare(data, "update", { prisma: this.prisma, actor }, existing) : data;

    let row: Row;
    try {
      row = await delegate.update({ where: { id }, data: prepared });
    } catch (error) {
      friendlyError(error);
    }
    const diff = changedFields(existing, row);
    if (Object.keys(diff.after).length) {
      await this.activity.log(actor, "updated", `Edited ${resource.singular.toLowerCase()} “${String(row[resource.titleField] ?? "")}” (${Object.keys(diff.after).join(", ")})`, { type: key, id }, {
        kind: "updated",
        model: resource.model,
        id,
        before: diff.before,
        after: diff.after,
        topic: resource.topic ?? key,
      });
      this.afterWrite(resource, `${resource.key}.updated`, row);
    }
    return row;
  }

  async remove(key: string, id: string, actor: Actor & { id: string; name: string }) {
    const resource = this.resource(key);
    if (resource.canDelete === false) throw new BadRequestException(`${resource.label} can't be deleted.`);
    const delegate = this.delegate(resource.model);
    const existing = await delegate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`${resource.singular} not found.`);
    try {
      await delegate.delete({ where: { id } });
    } catch (error) {
      friendlyError(error);
    }
    const title = String(existing[resource.titleField] ?? "");
    // Records whose deletion also removes others (a class and its attendance…) can't be brought back whole.
    const undo = resource.cascades ? null : ({ kind: "deleted", model: resource.model, id, before: plain(existing), topic: resource.topic ?? key } as const);
    await this.activity.log(actor, "deleted", `Deleted ${resource.singular.toLowerCase()} “${title}”`, { type: key, id }, undo);
    this.afterWrite(resource, `${resource.key}.deleted`, { id });
    return { deleted: true };
  }

  private afterWrite(resource: ResourceDef, event: string, row: Row): void {
    this.events.emit([resource.topic ?? resource.key]);
    this.events.noteWrite();
    this.webhooks.dispatch(event, row);
  }

  /** Spreadsheet (CSV) of every record matching the list filters. Opens in Excel and Google Sheets. */
  async exportCsv(key: string, query: ListQuery): Promise<{ filename: string; csv: string }> {
    const resource = this.resource(key);
    const rows = await this.delegate(resource.model).findMany({
      where: this.where(resource, query),
      orderBy: this.orderBy(resource, query),
      take: EXPORT_LIMIT,
      include: this.include(resource),
    });
    const columns = resource.fields.filter((field) => field.type !== "json");
    const cell = (value: unknown): string => {
      let text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
      // Stop spreadsheet programs from running a cell as a formula (CSV injection).
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const header = columns.map((field) => cell(field.label)).join(",");
    const lines = rows.map((row) =>
      columns
        .map((field) => {
          if (field.type === "ref" && field.relation) {
            const related = row[field.relation] as Row | null | undefined;
            const title = field.ref === "staff" ? "name" : getResource(field.ref!)?.titleField ?? "id";
            return cell(related?.[title] ?? row[field.name]);
          }
          const value = row[field.name];
          return cell(value !== null && typeof value === "object" && "toNumber" in (value as object) ? (value as Prisma.Decimal).toNumber() : value);
        })
        .join(",")
    );
    const date = new Date().toISOString().slice(0, 10);
    // The byte-order mark makes Excel read accents (ü, é) correctly.
    return { filename: `${key}-${date}.csv`, csv: "﻿" + [header, ...lines].join("\r\n") };
  }

  // ── Public website reads ───────────────────────────────────────────────────

  private publicResource(key: string): ResourceDef & { public: NonNullable<ResourceDef["public"]> } {
    const resource = getResource(key);
    if (!resource?.public) throw new NotFoundException("Not found.");
    return resource as ResourceDef & { public: NonNullable<ResourceDef["public"]> };
  }

  async publicList(key: string, query: ListQuery) {
    const resource = this.publicResource(key);
    const select = Object.fromEntries(resource.public.fields.map((name) => [name, true]));
    const base: Record<string, unknown> = { ...resource.public.where };
    if (key === "announcements") base.OR = [{ expiresAt: null }, { expiresAt: { gte: new Date(new Date().toISOString().slice(0, 10)) } }];
    const where = this.where(resource, query, base);
    const sort = resource.public.sort ?? resource.sort ?? { field: "createdAt", dir: "desc" as const };
    const take = Math.min(Number(query.pageSize) || resource.public.limit || 100, resource.public.limit ?? 100);
    const items = await this.delegate(resource.model).findMany({ where, select, orderBy: [{ [sort.field]: sort.dir }, { id: "asc" }], take });
    return key === "library" ? items.map((item) => (item.free ? item : { ...item, fileUrl: null })) : items;
  }

  async publicGet(key: string, idOrSlug: string) {
    const resource = this.publicResource(key);
    const select = Object.fromEntries(resource.public.fields.map((name) => [name, true]));
    const hasSlug = resource.fields.some((field) => field.name === "slug");
    const row = await this.delegate(resource.model).findFirst({
      where: { AND: [resource.public.where, hasSlug ? { OR: [{ slug: idOrSlug }, { id: idOrSlug }] } : { id: idOrSlug }] },
      select,
    });
    if (!row) throw new NotFoundException("Not found.");
    return key === "library" && !row.free ? { ...row, fileUrl: null } : row;
  }
}
