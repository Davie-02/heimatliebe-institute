import { icsText } from "./feeds.controller";

describe("icsText", () => {
  it("escapes the characters the calendar format reserves", () => {
    expect(icsText("Term 1; A1, A2\nBring books\\pens")).toBe("Term 1\; A1\\, A2\\nBring books\\\\pens");
  });
});
