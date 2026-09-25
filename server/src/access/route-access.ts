/**
 * Which module (and level) each staff API route needs. RolesGuard consults this for every staff
 * request, so access is enforced in ONE place rather than by role lists scattered across
 * controllers. A staff route that matches no rule is refused (except for the system administrator).
 *
 * Default level: reading (GET) needs "view", anything that changes data needs "edit".
 * Rules can ask for "manage" (exports, deleting personal or financial records).
 */
import type { Level, ModuleKey } from "./modules";
import { getResource } from "../resources/registry";

export type RouteAccess =
  /** Any signed-in staff member (their own account, the dashboard, directory, messages…). */
  | { kind: "staff" }
  /** At least `level` in ANY of these modules. */
  | { kind: "modules"; modules: ModuleKey[]; level: Level };

type Rule = [RegExp, (m: RegExpMatchArray, write: boolean, method: string) => RouteAccess | null];

const one = (module: ModuleKey, write: boolean, level?: Level): RouteAccess => ({ kind: "modules", modules: [module], level: level ?? (write ? "edit" : "view") });
const any = (modules: ModuleKey[], write: boolean, level?: Level): RouteAccess => ({ kind: "modules", modules, level: level ?? (write ? "edit" : "view") });
const STAFF: RouteAccess = { kind: "staff" };

/** Access for the generic record screens: the resource's own module; deleting may need more. */
function resourceAccess(key: string, rest: string | undefined, write: boolean, method: string): RouteAccess | null {
  if (key === "_schema") return STAFF;
  const resource = getResource(key);
  if (!resource) return null;
  if (rest === "/options") return any([resource.module, ...(resource.pickerModules ?? [])], false);
  if (rest === "/export") return one(resource.module, true, "manage");
  if (method === "DELETE") return one(resource.module, true, resource.deleteLevel ?? "edit");
  return one(resource.module, write);
}

// First match wins, so specific rules come before general ones.
const RULES: Rule[] = [
  [/^\/auth(\/|$)/, () => STAFF],
  [/^\/workspace\/system-status$/, () => one("system", false)],
  [/^\/workspace\/test-email$/, () => one("system", true, "manage")],
  [/^\/workspace(\/|$)/, () => STAFF],
  [/^\/activity(\/|$)/, () => STAFF], // the service limits non-system staff to their own actions
  [/^\/guides$/, (_m, w) => (w ? one("system", true) : STAFF)],
  [/^\/guides\/.+/, (_m, w) => (w ? one("system", true) : STAFF)],
  [/^\/messages(\/|$)/, () => STAFF],
  [/^\/notifications(\/|$)/, () => STAFF],
  [/^\/uploads$/, (_m, w) => any(["website", "academics", "teaching", "admissions", "students", "finance", "communication", "hr"], w)],
  [/^\/hr\/directory$/, () => STAFF],
  [/^\/hr\/leave\/me(\/|$)/, () => STAFF],
  [/^\/hr(\/|$)/, (_m, w) => one("hr", w)],
  // Staff accounts: HR or System. The service adds finer rules (only system administrators change access or touch owners).
  [/^\/staff-accounts\/options$/, () => STAFF],
  [/^\/staff-accounts(\/|$)/, (_m, w) => any(["system", "hr"], w, w ? "manage" : "view")],
  [/^\/r\/([^/]+)(\/options|\/export)?(\/[^/]+)?$/, (m, w, method) => resourceAccess(m[1], m[2], w, method)],
  [/^\/admissions(\/|$)/, (_m, w) => one("admissions", w)],
  [/^\/students\/[^/]+\/(overview|invite)$/, (_m, w) => one("students", w)],
  [/^\/teaching(\/|$)/, (_m, w) => any(["teaching", "academics"], w)],
  [/^\/academics(\/|$)/, (_m, w) => one("academics", w)],
  [/^\/finance\/export$/, () => one("finance", true, "manage")],
  [/^\/finance(\/|$)/, (_m, w) => one("finance", w)],
  [/^\/communication(\/|$)/, (_m, w) => one("communication", w)],
  // Institute settings (currency, pass mark, fees) are a system matter; website text is marketing's.
  [/^\/site-content\/institution$/, (_m, w) => (w ? one("system", true) : one("website", false))],
  [/^\/site-content(\/|$)/, (_m, w) => one("website", w)],
  [/^\/assistant\/admin(\/|$)/, (_m, w) => one("assistant", w)],
  [/^\/reports(\/|$)/, (_m, w) => one("insights", w)],
];

/** The access a staff route needs, or null when this table doesn't know the route. */
export function accessForRoute(method: string, path: string): RouteAccess | null {
  const route = path.replace(/^\/api/, "").replace(/\/+$/, "") || "/";
  const upper = method.toUpperCase();
  const write = !["GET", "HEAD", "OPTIONS"].includes(upper);
  for (const [pattern, resolve] of RULES) {
    const match = route.match(pattern);
    if (match) return resolve(match, write, upper);
  }
  return null;
}
