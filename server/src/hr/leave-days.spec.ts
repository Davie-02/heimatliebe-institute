import { workingDays } from "./leave-days";

describe("workingDays", () => {
  it("counts Monday to Friday only", () => {
    // 2026-09-21 is a Monday.
    expect(workingDays(new Date("2026-09-21"), new Date("2026-09-27"))).toBe(5);
    expect(workingDays(new Date("2026-09-26"), new Date("2026-09-27"))).toBe(0);
    expect(workingDays(new Date("2026-09-25"), new Date("2026-09-28"))).toBe(2);
  });

  it("returns 0 when the end is before the start", () => {
    expect(workingDays(new Date("2026-09-25"), new Date("2026-09-20"))).toBe(0);
  });
});
