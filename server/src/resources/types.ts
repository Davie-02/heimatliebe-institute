import type { PrismaService } from "../prisma/prisma.service";
import type { Level, ModuleKey } from "../access/modules";

/**
 * Types for the resource registry (registry.ts): one description per kind of record that staff
 * manage through the generic list/create/edit/delete screens. The same description drives
 * validation on the server and the forms and tables in the browser (it is sent to the browser
 * by GET /api/r/_schema), so a new field is added in exactly one place.
 */

export type FieldType =
  | "string" // one line of text
  | "text" // several lines
  | "richtext" // longer text with paragraphs (news articles, course descriptions)
  | "email"
  | "phone"
  | "url"
  | "image" // an uploaded picture (stored as its URL)
  | "file" // an uploaded document (stored as its URL)
  | "int"
  | "number"
  | "money"
  | "bool"
  | "date" // YYYY-MM-DD
  | "datetime"
  | "time" // HH:MM
  | "enum" // one of `options`
  | "ref" // the id of a record in another resource (`ref`)
  | "json";

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  /** Display names for `options` when the stored value isn't readable (e.g. weekday numbers). */
  optionLabels?: Record<string, string>;
  /** For "ref": the resource key the id points to, and the Prisma relation to include for display. */
  ref?: string;
  relation?: string;
  /** Show as a column in the list. */
  list?: boolean;
  /** Shown but never written through the generic API (set by the system). */
  readOnly?: boolean;
  /** Not shown in forms at all (still validated if sent). */
  hidden?: boolean;
  help?: string;
  default?: unknown;
  min?: number;
  max?: number;
  /** Maximum length for text fields (default 200 for one-line fields, 20 000 for long text). */
  maxLength?: number;
}

export interface HookContext {
  prisma: PrismaService;
  actor: { id: string; name: string };
}

export interface ResourceDef {
  /** URL name: /api/r/<key>. */
  key: string;
  /** Prisma delegate name (camelCase model name). */
  model: string;
  label: string;
  singular: string;
  description?: string;
  module: ModuleKey;
  /** Field used as the record's name in lists, pickers and the activity log. */
  titleField: string;
  fields: FieldDef[];
  /** Fields searched by ?q=. */
  search?: string[];
  /** Fields that can be filtered by exact value (?status=pending). */
  filters?: string[];
  sort?: { field: string; dir: "asc" | "desc" };
  /** Whether staff can add / delete through the generic screens (default true / true). */
  canCreate?: boolean;
  canUpdate?: boolean;
  canDelete?: boolean;
  /** Level needed to delete (default "edit"). Financial and personal records need "manage". */
  deleteLevel?: Level;
  /** Other modules whose editors may look records up in pickers (e.g. finance picking a student). */
  pickerModules?: ModuleKey[];
  /** Deleting also removes dependent records, so a delete can't be fully undone. */
  cascades?: boolean;
  /** Anonymous read access for the public website: which records and which fields. */
  public?: { where: Record<string, unknown>; fields: string[]; sort?: { field: string; dir: "asc" | "desc" }; limit?: number };
  /** Live-update topic sent to browsers after a change (defaults to the key). */
  topic?: string;
  /** Adjust data before it is saved (generate numbers and slugs, derive totals). */
  prepare?: (data: Record<string, unknown>, mode: "create" | "update", ctx: HookContext, existing?: Record<string, unknown>) => Promise<Record<string, unknown>>;
}
