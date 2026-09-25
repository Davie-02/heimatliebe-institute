import { RESOURCES, getResource } from "./registry";
import { isSafeLink, validateInput } from "./validate";

describe("validateInput", () => {
  const courses = getResource("courses")!;

  it("accepts and converts a valid course", () => {
    const { data, errors } = validateInput(courses, { title: "German A1", language: "German", feeAmount: "150,000", published: "true", capacity: "20" }, "create");
    expect(errors).toEqual({});
    expect(data).toMatchObject({ title: "German A1", language: "German", feeAmount: 150000, published: true, capacity: 20 });
  });

  it("refuses fields that are not in the list", () => {
    const { errors } = validateInput(getResource("invoices")!, { studentId: "abc123def", description: "Term 1", amount: 10, passwordHash: "x" }, "create");
    expect(errors.passwordHash).toBeDefined();
  });

  it("ignores read-only fields instead of writing them", () => {
    const { data, errors } = validateInput(getResource("invoices")!, { paid: 999999, amount: 100 }, "update");
    expect(errors).toEqual({});
    expect(data).toEqual({ amount: 100 });
  });

  it("requires required fields on create only", () => {
    expect(validateInput(courses, {}, "create").errors.title).toContain("required");
    expect(validateInput(courses, { summary: "x" }, "update").errors).toEqual({});
    expect(validateInput(courses, { title: "  " }, "update").errors.title).toContain("required");
  });

  it("checks formats", () => {
    const students = getResource("students")!;
    expect(validateInput(students, { email: "not-an-email" }, "update").errors.email).toBeDefined();
    expect(validateInput(students, { dateOfBirth: "2026-02-31x" }, "update").errors.dateOfBirth).toBeDefined();
    expect(validateInput(students, { level: "Z9" }, "update").errors.level).toBeDefined();
    expect(validateInput(students, { photoUrl: "javascript:alert(1)" }, "update").errors.photoUrl).toBeDefined();
  });

  it("only stores safe links", () => {
    expect(isSafeLink("https://example.org/a.pdf")).toBe(true);
    expect(isSafeLink("/api/media/uploads/a.webp")).toBe(true);
    expect(isSafeLink("//evil.example")).toBe(false);
    expect(isSafeLink("data:text/html,hi")).toBe(false);
  });

  it("every resource is internally consistent", () => {
    const keys = new Set(RESOURCES.map((r) => r.key));
    for (const resource of RESOURCES) {
      for (const field of resource.fields) {
        if (field.type === "ref") expect(field.ref === "staff" || keys.has(field.ref!)).toBe(true);
        if (field.type === "enum") expect(field.options?.length).toBeGreaterThan(0);
      }
      for (const name of [...(resource.search ?? []), ...(resource.filters ?? [])]) {
        expect(resource.fields.some((field) => field.name === name) || name.endsWith("Id")).toBe(true);
      }
      for (const name of resource.public?.fields ?? []) {
        expect(["id", "createdAt"].includes(name) || resource.fields.some((field) => field.name === name)).toBe(true);
      }
    }
  });
});
