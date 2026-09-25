import { balanceOf, invoiceStatus } from "./invoice-status";

describe("invoiceStatus", () => {
  const today = new Date("2026-09-25T10:00:00Z");
  it("works out the status from the numbers", () => {
    expect(invoiceStatus({ amount: 100, discount: 0, paid: 100, dueDate: null }, today)).toBe("paid");
    expect(invoiceStatus({ amount: 100, discount: 20, paid: 80, dueDate: null }, today)).toBe("paid");
    expect(invoiceStatus({ amount: 100, discount: 0, paid: 40, dueDate: new Date("2026-01-01") }, today)).toBe("partial");
    expect(invoiceStatus({ amount: 100, discount: 0, paid: 0, dueDate: new Date("2026-09-24") }, today)).toBe("overdue");
    expect(invoiceStatus({ amount: 100, discount: 0, paid: 0, dueDate: new Date("2026-09-25") }, today)).toBe("pending");
    expect(invoiceStatus({ amount: 100, discount: 0, paid: 0, dueDate: null, status: "cancelled" }, today)).toBe("cancelled");
  });

  it("computes balances without floating point noise", () => {
    expect(balanceOf({ amount: "0.3", discount: "0.1", paid: "0.2" })).toBe(0);
  });
});
