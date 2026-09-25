import { isCommonPassword, passwordProblems } from "./password-policy";

describe("passwordProblems", () => {
  it("accepts a strong password", () => {
    expect(passwordProblems("Harbour-Lantern-42")).toEqual([]);
  });

  it("explains every rule that is broken", () => {
    const problems = passwordProblems("abc");
    expect(problems.join(" ")).toContain("at least 10");
    expect(problems.join(" ")).toContain("uppercase");
    expect(problems.join(" ")).toContain("number");
  });

  it("rejects common passwords even when disguised with digits or symbols", () => {
    expect(isCommonPassword("Password")).toBe(true);
    expect(isCommonPassword("password123!")).toBe(true);
    expect(isCommonPassword("Harbour-Lantern-42")).toBe(false);
    expect(passwordProblems("Password123!").join(" ")).toContain("too common");
  });

  it("rejects passwords containing the person's own name or email", () => {
    expect(passwordProblems("Chikondi-2026-Xy", ["Chikondi Banda", "x@example.com"]).join(" ")).toContain("name or email");
    expect(passwordProblems("Harbour-Lantern-42", ["Chikondi Banda"])).toEqual([]);
  });

  it("refuses passwords longer than bcrypt can use", () => {
    expect(passwordProblems("Aa1" + "x".repeat(80)).join(" ")).toContain("no more than");
  });
});
