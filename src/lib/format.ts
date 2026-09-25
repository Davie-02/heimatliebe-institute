/** Display helpers: money, dates and times in the way people in Malawi read them. */

export function money(amount: number | string | null | undefined, currency = "MWK"): string {
  const value = Number(amount ?? 0);
  return `${currency} ${value.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Calendar dates are stored at midnight UTC, so they are shown in UTC to avoid slipping a day. */
export function date(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : dateFormat.format(d);
}

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFormat.format(d);
}

export function relative(value: string | Date | null | undefined): string {
  if (!value) return "";
  const diff = (Date.now() - new Date(value).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} d ago`;
  return date(value);
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("");
}

/** "2026-09-25" for <input type="date"> from a stored date. */
export function toDateInput(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/** "2026-09-25T14:30" for <input type="datetime-local"> in the viewer's own time zone. */
export function toDateTimeInput(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function statusTone(status: string): string {
  const map: Record<string, string> = {
    paid: "success", confirmed: "success", accepted: "success", approved: "success", active: "success", present: "success", converted: "success", published: "success", awarded: "success", sat: "success",
    partial: "warning", pending: "warning", reviewing: "info", waitlisted: "info", follow_up: "warning", late: "warning", contacted: "info", planned: "info", new: "brand",
    overdue: "danger", rejected: "danger", cancelled: "danger", absent: "danger", suspended: "danger", closed: "", dropped: "danger", revoked: "danger",
  };
  return map[status] ?? "";
}

export function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
