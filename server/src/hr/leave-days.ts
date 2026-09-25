/** Working days (Monday–Friday) from start to end inclusive. Dates are calendar dates (UTC midnight). */
export function workingDays(start: Date, end: Date): number {
  if (end < start) return 0;
  let days = 0;
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  while (cursor.getTime() <= last) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) days++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}
