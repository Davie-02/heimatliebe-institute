/**
 * The browser's copy of the access levels (server: server/src/access/modules.ts). It only decides
 * what to SHOW; every request is checked again by the server.
 */
import type { AccessMap, Level, ModuleKey, StaffUser } from "@/lib/types";

export const LEVELS: Level[] = ["none", "view", "edit", "manage"];
export const atLeast = (have: Level | undefined, need: Level) => LEVELS.indexOf(have ?? "none") >= LEVELS.indexOf(need);

export function can(user: Pick<StaffUser, "role" | "access">, module: ModuleKey, level: Level = "view"): boolean {
  return user.role === "OWNER" || atLeast(user.access[module], level);
}

export const MODULE_LABELS: Record<ModuleKey, string> = {
  admissions: "Admissions",
  students: "Students",
  academics: "Academics",
  teaching: "My teaching",
  finance: "Finance",
  communication: "Communication",
  website: "Website",
  assistant: "Website assistant",
  insights: "Reports",
  hr: "People (HR)",
  system: "System",
};

export type { AccessMap };
