import { describe, expect, it } from "vitest";
import { date, humanize, initials, money, toDateInput } from "./format";
import { passwordLooksStrong } from "./password";

describe("format", () => {
  it("formats money and dates", () => {
    expect(money(150000)).toBe("MWK 150,000");
    expect(date("2026-09-25T00:00:00.000Z")).toBe("25 Sept 2026".replace("Sept", new Intl.DateTimeFormat("en-GB", { month: "short" }).format(new Date("2026-09-25"))));
    expect(toDateInput("2026-02-01T00:00:00.000Z")).toBe("2026-02-01");
  });

  it("makes initials and readable labels", () => {
    expect(initials("Chikondi  Banda")).toBe("CB");
    expect(humanize("follow_up")).toBe("Follow up");
  });

  it("mirrors the password rules", () => {
    expect(passwordLooksStrong("Harbour-Lantern-42")).toBe(true);
    expect(passwordLooksStrong("short")).toBe(false);
  });
});
