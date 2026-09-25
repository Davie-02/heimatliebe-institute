/** An invoice's status from its numbers: what's left to pay, and whether it's late. */
export function invoiceStatus(input: { amount: number; discount: number; paid: number; dueDate: Date | null; status?: string }, today = new Date()): string {
  if (input.status === "cancelled") return "cancelled";
  const balance = Math.round((input.amount - input.discount - input.paid) * 100) / 100;
  if (balance <= 0) return "paid";
  if (input.paid > 0) return "partial";
  const startOfToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (input.dueDate && input.dueDate < startOfToday) return "overdue";
  return "pending";
}

export function balanceOf(input: { amount: unknown; discount: unknown; paid: unknown }): number {
  // "+ 0" turns a negative zero into a plain 0.
  return Math.round((Number(input.amount) - Number(input.discount) - Number(input.paid)) * 100) / 100 + 0;
}
