import { Prisma } from "@prisma/client";
import { changedFields, plain } from "./activity.service";
import "../prisma/decimal-json";

describe("changedFields", () => {
  it("keeps only what changed, as plain values", () => {
    const before = { id: "1", title: "A", fee: new Prisma.Decimal("10.5"), startDate: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date() };
    const after = { id: "1", title: "B", fee: new Prisma.Decimal("10.5"), startDate: new Date("2026-02-01T00:00:00Z"), updatedAt: new Date() };
    expect(changedFields(before, after)).toEqual({
      before: { title: "A", startDate: "2026-01-01T00:00:00.000Z" },
      after: { title: "B", startDate: "2026-02-01T00:00:00.000Z" },
    });
  });

  it("turns decimals into numbers", () => {
    expect(plain({ amount: new Prisma.Decimal("1500.25") })).toEqual({ amount: 1500.25 });
  });
});
