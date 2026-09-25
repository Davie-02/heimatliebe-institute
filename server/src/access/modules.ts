/**
 * The institute's workspace areas ("modules"), its departments, and who can do what.
 *
 * Access is per module, at one of four levels:
 *   none   – the module is hidden
 *   view   – can open and read it
 *   edit   – can add, change and handle work in it
 *   manage – edit, plus the module's sensitive tools (exports, deleting records, inviting staff in HR)
 *
 * A staff member's access = their department's defaults (plus management defaults for role
 * MANAGER), then any per-person overrides a system administrator set. The system administrator
 * (role OWNER) always has everything.
 *
 * The browser has a mirror of the keys and labels in src/admin/access.ts — keep them in step.
 */

export const LEVELS = ["none", "view", "edit", "manage"] as const;
export type Level = (typeof LEVELS)[number];

export const MODULE_KEYS = [
  "admissions",
  "students",
  "academics",
  "teaching",
  "finance",
  "communication",
  "website",
  "assistant",
  "insights",
  "hr",
  "system",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface ModuleInfo {
  key: ModuleKey;
  label: string;
  description: string;
}

export const MODULES: ModuleInfo[] = [
  { key: "admissions", label: "Admissions", description: "Applications, enquiries, placement tests and official exam registrations" },
  { key: "students", label: "Students", description: "Student records, enrolments, certificates and scholarships" },
  { key: "academics", label: "Academics", description: "Courses, all classes, timetable, exams, exam sessions and the calendar" },
  { key: "teaching", label: "My teaching", description: "Your own classes: attendance, assignments, marking and the gradebook" },
  { key: "finance", label: "Finance", description: "Fees, invoices, payments, receipts, statements and scholarships" },
  { key: "communication", label: "Communication", description: "Announcements and messages to students and staff" },
  { key: "website", label: "Website", description: "Homepage text, news, gallery, documents, testimonials, FAQ and the library" },
  { key: "assistant", label: "Website assistant", description: "What the assistant knows, questions visitors asked and drafted FAQ answers" },
  { key: "insights", label: "Reports", description: "Numbers, trends and exports across the institute" },
  { key: "hr", label: "People (HR)", description: "Staff directory, inviting staff and leave requests" },
  { key: "system", label: "System", description: "Staff access, activity and undo, integrations and system status" },
];

export const DEPARTMENTS: Record<string, { label: string; access: Partial<Record<ModuleKey, Level>> }> = {
  director: {
    label: "Director",
    access: {
      admissions: "manage", students: "manage", academics: "manage", teaching: "edit", finance: "manage",
      communication: "manage", website: "manage", assistant: "edit", insights: "manage", hr: "view",
    },
  },
  management: {
    label: "Management",
    access: {
      admissions: "edit", students: "edit", academics: "edit", teaching: "edit", finance: "edit",
      communication: "edit", website: "edit", assistant: "edit", insights: "view", hr: "view",
    },
  },
  academic: {
    label: "Academic office",
    access: { academics: "edit", teaching: "edit", students: "edit", admissions: "view", communication: "edit", insights: "view" },
  },
  teaching: { label: "Teaching", access: { teaching: "edit", students: "view", academics: "view", communication: "view" } },
  admissions: {
    label: "Admissions & front office",
    access: { admissions: "edit", students: "edit", communication: "edit", academics: "view", finance: "view", assistant: "view" },
  },
  finance: { label: "Finance", access: { finance: "edit", students: "view", admissions: "view", insights: "view" } },
  marketing: { label: "Marketing & website", access: { website: "edit", assistant: "edit", admissions: "view", insights: "view" } },
  hr: { label: "Human resources", access: { hr: "manage" } },
  general: { label: "General staff", access: {} },
};

const rank = (level: Level) => LEVELS.indexOf(level);
export const atLeast = (have: Level | undefined, need: Level) => rank(have ?? "none") >= rank(need);

export function isLevel(value: unknown): value is Level {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === "string" && (MODULE_KEYS as readonly string[]).includes(value);
}

export type AccessMap = Record<ModuleKey, Level>;

function empty(): AccessMap {
  return Object.fromEntries(MODULE_KEYS.map((key) => [key, "none"])) as AccessMap;
}

/** Keeps only valid "module: level" pairs from stored overrides (the column is free-form JSON). */
export function cleanOverrides(raw: unknown): Partial<Record<ModuleKey, Level>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Partial<Record<ModuleKey, Level>> = {};
  for (const [key, value] of Object.entries(raw)) if (isModuleKey(key) && isLevel(value)) out[key] = value;
  return out;
}

/** The defaults an account gets before overrides: management defaults for managers, then the department's. */
export function baseAccess(role: string, department: string | null | undefined): AccessMap {
  const map = empty();
  if (role === "OWNER") return Object.fromEntries(MODULE_KEYS.map((key) => [key, "manage"])) as AccessMap;
  if (role === "MANAGER") Object.assign(map, DEPARTMENTS.management.access);
  if (department && DEPARTMENTS[department]) {
    // Department defaults add to (never shrink) the role's own; overrides below can shrink.
    for (const [key, level] of Object.entries(DEPARTMENTS[department].access) as Array<[ModuleKey, Level]>) {
      if (rank(level) > rank(map[key])) map[key] = level;
    }
  }
  return map;
}

/** Final access: defaults, then the system administrator's per-person overrides. Owners always get everything. */
export function effectiveAccess(role: string, department: string | null | undefined, overrides: unknown): AccessMap {
  const map = baseAccess(role, department);
  if (role === "OWNER") return map;
  return { ...map, ...cleanOverrides(overrides) };
}
