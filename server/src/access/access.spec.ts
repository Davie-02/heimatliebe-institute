import { accessForRoute } from "./route-access";
import { atLeast, baseAccess, effectiveAccess, MODULE_KEYS } from "./modules";

describe("effectiveAccess", () => {
  it("gives the system administrator everything", () => {
    const access = effectiveAccess("OWNER", "general", { finance: "none" });
    for (const key of MODULE_KEYS) expect(access[key]).toBe("manage");
  });

  it("starts from the department and applies overrides", () => {
    const teacher = effectiveAccess("EMPLOYEE", "teaching", { finance: "view", teaching: "none" });
    expect(teacher.teaching).toBe("none");
    expect(teacher.finance).toBe("view");
    expect(teacher.students).toBe("view");
    expect(teacher.system).toBe("none");
  });

  it("lets managers keep management defaults and gain their department's", () => {
    const access = baseAccess("MANAGER", "hr");
    expect(access.hr).toBe("manage");
    expect(access.finance).toBe("edit");
  });

  it("ignores junk in stored overrides", () => {
    const access = effectiveAccess("EMPLOYEE", "general", { finance: "everything", nothing: "edit" });
    expect(access.finance).toBe("none");
  });

  it("orders levels", () => {
    expect(atLeast("manage", "edit")).toBe(true);
    expect(atLeast("view", "edit")).toBe(false);
    expect(atLeast(undefined, "view")).toBe(false);
  });
});

describe("accessForRoute", () => {
  it("maps generic record routes to the resource's module", () => {
    expect(accessForRoute("GET", "/api/r/invoices")).toEqual({ kind: "modules", modules: ["finance"], level: "view" });
    expect(accessForRoute("PATCH", "/api/r/invoices/abc")).toEqual({ kind: "modules", modules: ["finance"], level: "edit" });
    expect(accessForRoute("DELETE", "/api/r/invoices/abc")).toEqual({ kind: "modules", modules: ["finance"], level: "manage" });
    expect(accessForRoute("GET", "/api/r/invoices/export")).toEqual({ kind: "modules", modules: ["finance"], level: "manage" });
  });

  it("lets other departments use pickers without opening the whole module", () => {
    const rule = accessForRoute("GET", "/api/r/students/options");
    expect(rule).toMatchObject({ kind: "modules", level: "view" });
    expect(rule && rule.kind === "modules" && rule.modules).toContain("finance");
  });

  it("refuses unknown routes and unknown resources", () => {
    expect(accessForRoute("GET", "/api/r/passwords")).toBeNull();
    expect(accessForRoute("GET", "/api/something-new")).toBeNull();
  });

  it("keeps personal pages open to all staff", () => {
    expect(accessForRoute("POST", "/api/hr/leave/me")).toEqual({ kind: "staff" });
    expect(accessForRoute("GET", "/api/workspace/overview")).toEqual({ kind: "staff" });
    expect(accessForRoute("POST", "/api/hr/leave/abc/decide")).toEqual({ kind: "modules", modules: ["hr"], level: "edit" });
  });
});
