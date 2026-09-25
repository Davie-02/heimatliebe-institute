import { applicationReference, randomCode, slugify, studentNumber } from "./codes";

describe("codes", () => {
  it("never uses look-alike characters", () => {
    for (let i = 0; i < 50; i++) expect(randomCode(20)).toMatch(/^[A-HJKMNP-Z2-9]+$/);
  });

  it("formats student numbers by year and sequence", () => {
    expect(studentNumber(2026, 42)).toBe("HMLI-2026-0042");
  });

  it("makes readable slugs", () => {
    expect(slugify("German A1 – Evening Class")).toBe("german-a1-evening-class");
    expect(slugify("Prüfung für Anfänger")).toBe("prufung-fur-anfanger");
    expect(slugify("Straße")).toBe("strasse");
  });

  it("makes application references", () => {
    expect(applicationReference()).toMatch(/^APP-[A-Z2-9]{8}$/);
  });
});
