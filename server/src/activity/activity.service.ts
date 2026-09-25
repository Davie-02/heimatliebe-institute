import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { EventsService } from "../events/events.service";
import { atLeast, type AccessMap } from "../access/modules";

/** Who did something. Public visitors and scheduled jobs are recorded too, without an id. */
export interface Actor {
  kind: "staff" | "student" | "public" | "system";
  id?: string;
  name?: string;
  ip?: string;
}

/**
 * What an undo needs:
 *  - created: the new record's id (undo deletes it);
 *  - updated: the fields before and after (undo puts the "before" back, unless someone changed them since);
 *  - deleted: the whole record (undo recreates it).
 */
export type UndoInfo =
  | { kind: "created"; model: string; id: string; topic?: string }
  | { kind: "updated"; model: string; id: string; before: Record<string, unknown>; after: Record<string, unknown>; topic?: string }
  | { kind: "deleted"; model: string; id: string; before: Record<string, unknown>; topic?: string };

const BOOKKEEPING = new Set(["id", "createdAt", "updatedAt"]);

/** Makes a record safe to keep as JSON (dates as text, decimals as numbers). */
export function plain(record: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
}

/** The fields an update actually changed, as { before, after } pairs of plain values. */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b = plain(before);
  const a = plain(after);
  const out = { before: {} as Record<string, unknown>, after: {} as Record<string, unknown> };
  for (const key of Object.keys(a)) {
    if (BOOKKEEPING.has(key)) continue;
    if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) {
      out.before[key] = b[key] ?? null;
      out.after[key] = a[key] ?? null;
    }
  }
  return out;
}

type Delegate = {
  findUnique: (args: { where: { id: string } }) => Promise<Record<string, unknown> | null>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  delete: (args: { where: { id: string } }) => Promise<unknown>;
  create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
};

/**
 * The activity log ("who changed what, when") and undo.
 * Staff see their own actions and can undo them; people with System access see everyone's.
 */
@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService
  ) {}

  async log(actor: Actor, action: string, summary: string, entity?: { type: string; id?: string }, undo?: UndoInfo | null): Promise<string | null> {
    try {
      const row = await this.prisma.activityLog.create({
        data: {
          actorKind: actor.kind,
          actorId: actor.id,
          actorName: actor.name,
          action,
          summary: summary.slice(0, 500),
          entity: entity?.type,
          entityId: entity?.id,
          undo: undo ? (plain(undo as unknown as Record<string, unknown>) as Prisma.InputJsonValue) : Prisma.JsonNull,
          ip: actor.ip,
        },
        select: { id: true },
      });
      this.events.emit(["activity"]);
      return row.id;
    } catch {
      // The log must never block the action it describes.
      return null;
    }
  }

  async list(viewer: { id: string; role: string; access: AccessMap }, query: { mine?: boolean; entity?: string; entityId?: string; cursor?: string; take?: number }) {
    const seeAll = viewer.role === "OWNER" || atLeast(viewer.access.system, "view");
    const take = Math.min(Math.max(query.take ?? 50, 1), 100);
    const where: Prisma.ActivityLogWhereInput = {
      ...(seeAll && !query.mine ? {} : { actorId: viewer.id }),
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
    };
    const rows = await this.prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: take + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const items = rows.slice(0, take).map((row) => ({
      id: row.id,
      actorKind: row.actorKind,
      actorName: row.actorName,
      actorId: row.actorId,
      action: row.action,
      summary: row.summary,
      entity: row.entity,
      entityId: row.entityId,
      createdAt: row.createdAt,
      undoneAt: row.undoneAt,
      undoneBy: row.undoneBy,
      canUndo: Boolean(row.undo) && !row.undoneAt && (row.actorId === viewer.id || viewer.role === "OWNER" || atLeast(viewer.access.system, "edit")),
    }));
    return { items, next: rows.length > take ? items[items.length - 1].id : null };
  }

  async undo(logId: string, viewer: { id: string; name: string; role: string; access: AccessMap }, ip?: string) {
    const row = await this.prisma.activityLog.findUnique({ where: { id: logId } });
    if (!row) throw new NotFoundException("That action wasn't found.");
    if (row.undoneAt) throw new ConflictException({ code: "UNDO_CONFLICT", message: "That action has already been undone." });
    if (!row.undo) throw new ConflictException({ code: "UNDO_CONFLICT", message: "That action can't be undone." });
    const mayUndo = row.actorId === viewer.id || viewer.role === "OWNER" || atLeast(viewer.access.system, "edit");
    if (!mayUndo) throw new ForbiddenException("Only the person who did this, or a system administrator, can undo it.");

    const undo = row.undo as unknown as UndoInfo;
    const delegate = (this.prisma as unknown as Record<string, Delegate>)[undo.model];
    if (!delegate) throw new ConflictException({ code: "UNDO_CONFLICT", message: "That action can't be undone." });

    const current = await delegate.findUnique({ where: { id: undo.id } });
    if (undo.kind === "created") {
      if (current) await delegate.delete({ where: { id: undo.id } });
    } else if (undo.kind === "updated") {
      if (!current) throw new ConflictException({ code: "UNDO_CONFLICT", message: "The record has since been deleted." });
      const now = plain(current);
      const changedSince = Object.keys(undo.after).some((key) => JSON.stringify(now[key] ?? null) !== JSON.stringify(undo.after[key] ?? null));
      if (changedSince) throw new ConflictException({ code: "UNDO_CONFLICT", message: "Someone has changed this record since, so it can't be undone automatically." });
      await delegate.update({ where: { id: undo.id }, data: undo.before });
    } else {
      if (current) throw new ConflictException({ code: "UNDO_CONFLICT", message: "The record already exists again." });
      const data = Object.fromEntries(Object.entries(undo.before).filter(([key]) => key !== "updatedAt"));
      await delegate.create({ data });
    }

    const now = new Date();
    await this.prisma.activityLog.update({ where: { id: logId }, data: { undoneAt: now, undoneBy: viewer.name } });
    await this.log({ kind: "staff", id: viewer.id, name: viewer.name, ip }, "undid", `Undid: ${row.summary}`, row.entity ? { type: row.entity, id: row.entityId ?? undefined } : undefined, null);
    if (undo.topic) this.events.emit([undo.topic]);
    this.events.noteWrite();
    return { undone: true };
  }
}
