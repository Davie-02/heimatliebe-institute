import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { EventsService } from "../events/events.service";
import { ActivityService, changedFields, type Actor } from "../activity/activity.service";
import { isSafeLink } from "../resources/validate";
import { CONTENT_DEFAULTS, type ContentKey } from "./defaults";

const CACHE_MS = 30_000;

/**
 * Checks a saved value against the default's shape: same keys, same kinds of values (text,
 * number, yes/no, list, group). Text is trimmed and size-limited; links must be safe.
 */
export function cleanContent(defaults: Record<string, unknown>, input: unknown, path = ""): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BadRequestException(`${path || "Content"} must be a group of fields.`);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!(key in defaults)) throw new BadRequestException(`Unknown setting “${path}${key}”.`);
    out[key] = cleanValue(defaults[key], value, `${path}${key}`);
  }
  return out;
}

function cleanValue(template: unknown, value: unknown, path: string): unknown {
  if (typeof template === "string") {
    if (typeof value !== "string") throw new BadRequestException(`“${path}” must be text.`);
    const text = value.trim();
    if (text.length > 10_000) throw new BadRequestException(`“${path}” is too long.`);
    if (/(Url|Image|image|social[A-Z]\w*)$/.test(path) && text && !isSafeLink(text)) throw new BadRequestException(`“${path}” must be a web address starting with https://`);
    return text;
  }
  if (typeof template === "number") {
    const number = typeof value === "string" ? Number(value) : value;
    if (typeof number !== "number" || !Number.isFinite(number)) throw new BadRequestException(`“${path}” must be a number.`);
    return number;
  }
  if (typeof template === "boolean") {
    if (typeof value !== "boolean") throw new BadRequestException(`“${path}” must be yes or no.`);
    return value;
  }
  if (Array.isArray(template)) {
    if (!Array.isArray(value) || value.length > 100) throw new BadRequestException(`“${path}” must be a list of up to 100 items.`);
    const item = template[0];
    return value.map((entry, index) => (item && typeof item === "object" ? cleanContent(item as Record<string, unknown>, entry, `${path}[${index}].`) : cleanValue(item ?? "", entry, `${path}[${index}]`)));
  }
  if (template && typeof template === "object") return cleanContent(template as Record<string, unknown>, value, `${path}.`);
  return value;
}

/** Website text and institute settings, with defaults for anything never saved. */
@Injectable()
export class SiteContentService {
  private cache: { value: Record<ContentKey, Record<string, unknown>>; until: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly activity: ActivityService
  ) {
    this.events.onWrite(() => (this.cache = null));
  }

  async all(): Promise<Record<ContentKey, Record<string, unknown>>> {
    if (this.cache && this.cache.until > Date.now()) return this.cache.value;
    const rows = await this.prisma.siteContent.findMany({ where: { key: { in: Object.keys(CONTENT_DEFAULTS) } } });
    const value = Object.fromEntries(
      Object.entries(CONTENT_DEFAULTS).map(([key, defaults]) => {
        const saved = rows.find((row) => row.key === key)?.value;
        return [key, { ...defaults, ...(saved && typeof saved === "object" && !Array.isArray(saved) ? (saved as Record<string, unknown>) : {}) }];
      })
    ) as unknown as Record<ContentKey, Record<string, unknown>>;
    this.cache = { value, until: Date.now() + CACHE_MS };
    return value;
  }

  async get<K extends ContentKey>(key: K): Promise<(typeof CONTENT_DEFAULTS)[K]> {
    return (await this.all())[key] as (typeof CONTENT_DEFAULTS)[K];
  }

  async save(key: string, input: unknown, actor: Actor & { id: string; name: string }) {
    if (!(key in CONTENT_DEFAULTS)) throw new NotFoundException("Unknown content.");
    const typedKey = key as ContentKey;
    const defaults = CONTENT_DEFAULTS[typedKey] as Record<string, unknown>;
    const cleaned = cleanContent(defaults, input);
    const before = (await this.all())[typedKey];
    const merged = { ...before, ...cleaned };
    await this.prisma.siteContent.upsert({
      where: { key },
      create: { key, value: merged as Prisma.InputJsonValue },
      update: { value: merged as Prisma.InputJsonValue },
    });
    this.cache = null;
    const diff = changedFields(before, merged);
    if (Object.keys(diff.after).length) {
      await this.activity.log(actor, "updated", `Changed ${key === "site" ? "website text" : "institute settings"} (${Object.keys(diff.after).join(", ")})`, { type: "site-content", id: key });
    }
    this.events.emit(["site-content"]);
    this.events.noteWrite();
    return merged;
  }
}
