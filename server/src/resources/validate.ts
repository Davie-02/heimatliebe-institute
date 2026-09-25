import type { FieldDef, ResourceDef } from "./types";

/**
 * Checks and converts a create/update body against a resource's field list.
 * Returns clean data ready for Prisma, or plain-language problems keyed by field.
 *
 * - Fields not in the list are refused (so nobody can set e.g. `paid` or `passwordHash` by adding it).
 * - Read-only fields and bookkeeping fields (id, createdAt…) are ignored if sent back unchanged by a form.
 * - Empty strings become null for optional fields.
 */

const IGNORED = new Set(["id", "createdAt", "updatedAt"]);
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;
const PHONE = /^[+0-9 ()./-]{6,24}$/;
const DATE_OR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID = /^[a-zA-Z0-9_-]{6,64}$/;

export interface ValidationResult {
  data: Record<string, unknown>;
  errors: Record<string, string>;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

/** A link we are willing to store and later put in an href/src: http(s) or a path on our own site. */
export function isSafeLink(value: string): boolean {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function convert(field: FieldDef, raw: unknown): { value?: unknown; error?: string } {
  if (isEmpty(raw)) return { value: field.type === "bool" ? false : null };

  switch (field.type) {
    case "string":
    case "text":
    case "richtext": {
      if (typeof raw !== "string" && typeof raw !== "number") return { error: "Must be text." };
      const text = String(raw).trim();
      const max = field.maxLength ?? (field.type === "string" ? 200 : 20_000);
      if (text.length > max) return { error: `Keep it under ${max} characters.` };
      if (field.options && !field.options.includes(text)) return { error: "Choose one of the options." };
      return { value: text };
    }
    case "email": {
      const text = String(raw).trim().toLowerCase();
      return EMAIL.test(text) && text.length <= 254 ? { value: text } : { error: "Enter a valid email address." };
    }
    case "phone": {
      const text = String(raw).trim();
      return PHONE.test(text) ? { value: text } : { error: "Enter a valid phone number." };
    }
    case "url":
    case "image":
    case "file": {
      const text = String(raw).trim();
      if (text.length > 2000) return { error: "That address is too long." };
      return isSafeLink(text) ? { value: text } : { error: "Enter a web address starting with https://" };
    }
    case "int": {
      const number = typeof raw === "string" ? Number(raw) : raw;
      if (typeof number !== "number" || !Number.isInteger(number)) return { error: "Must be a whole number." };
      if (field.min !== undefined && number < field.min) return { error: `Must be at least ${field.min}.` };
      if (field.max !== undefined && number > field.max) return { error: `Must be at most ${field.max}.` };
      return { value: number };
    }
    case "number":
    case "money": {
      const number = typeof raw === "string" ? Number(raw.replace(/,/g, "")) : raw;
      if (typeof number !== "number" || !Number.isFinite(number)) return { error: "Must be a number." };
      if (field.min !== undefined && number < field.min) return { error: `Must be at least ${field.min}.` };
      if (field.max !== undefined && number > field.max) return { error: `Must be at most ${field.max}.` };
      if (field.type === "money" && Math.abs(number) >= 1e10) return { error: "That amount is too large." };
      return { value: field.type === "money" ? Math.round(number * 100) / 100 : number };
    }
    case "bool":
      if (raw === true || raw === "true") return { value: true };
      if (raw === false || raw === "false") return { value: false };
      return { error: "Must be yes or no." };
    case "date": {
      // A plain date, or the full timestamp a form sends back unchanged when editing.
      const full = String(raw).trim();
      if (!DATE_OR_TIMESTAMP.test(full)) return { error: "Use a date like 2026-09-25." };
      const text = full.slice(0, 10);
      const date = new Date(`${text}T00:00:00.000Z`);
      return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? { error: "That date doesn't exist." } : { value: date };
    }
    case "datetime": {
      const date = new Date(String(raw));
      return Number.isNaN(date.getTime()) ? { error: "Enter a valid date and time." } : { value: date };
    }
    case "time": {
      const text = String(raw).trim();
      return TIME.test(text) ? { value: text } : { error: "Use a time like 08:30." };
    }
    case "enum": {
      const text = String(raw);
      return field.options?.includes(text) ? { value: text } : { error: "Choose one of the options." };
    }
    case "ref": {
      const text = String(raw);
      return ID.test(text) ? { value: text } : { error: "Choose a record from the list." };
    }
    case "json": {
      const size = JSON.stringify(raw ?? null).length;
      return size > 400_000 ? { error: "This is too large to save." } : { value: raw };
    }
    default:
      return { error: "Unsupported field." };
  }
}

export function validateInput(resource: ResourceDef, body: unknown, mode: "create" | "update"): ValidationResult {
  const errors: Record<string, string> = {};
  const data: Record<string, unknown> = {};
  if (!body || typeof body !== "object" || Array.isArray(body)) return { data, errors: { _: "Send the record's fields as an object." } };

  const fields = new Map(resource.fields.map((field) => [field.name, field]));
  for (const [name, raw] of Object.entries(body as Record<string, unknown>)) {
    const field = fields.get(name);
    if (!field) {
      if (!IGNORED.has(name)) errors[name] = "This field can't be set.";
      continue;
    }
    if (field.readOnly) continue;
    const { value, error } = convert(field, raw);
    if (error) errors[name] = error;
    else if (value === null && field.required) errors[name] = `${field.label} is required.`;
    else data[name] = value;
  }

  if (mode === "create") {
    for (const field of resource.fields) {
      if (field.readOnly) continue;
      if (!(field.name in data) && field.default !== undefined) data[field.name] = field.default;
      if (field.required && isEmpty(data[field.name]) && !errors[field.name]) errors[field.name] = `${field.label} is required.`;
    }
  }
  return { data, errors };
}
