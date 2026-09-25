import { Status } from "@/components/ui";
import { mediaUrl } from "@/services/api";
import { date, dateTime, money } from "@/lib/format";
import type { FieldDef } from "./SchemaContext";

/** How a stored value looks in lists and detail pages. */
export function FieldValue({ field, row, currency }: { field: FieldDef; row: Record<string, unknown>; currency?: string }) {
  const value = row[field.name];
  if (field.type === "ref") {
    const related = field.relation ? (row[field.relation] as Record<string, unknown> | null) : null;
    return <>{related ? String(related.name ?? related.title ?? related.invoiceNo ?? related.studentNo ?? "—") : "—"}</>;
  }
  if (value === null || value === undefined || value === "") return <span className="faint">—</span>;
  switch (field.type) {
    case "bool":
      return value ? <span className="badge badge-success">Yes</span> : <span className="badge">No</span>;
    case "enum":
      return field.name === "status" || field.name === "channel" ? <Status value={String(value)} /> : <>{field.optionLabels?.[String(value)] ?? String(value)}</>;
    case "money":
      return <>{money(value as number, currency)}</>;
    case "date":
      return <>{date(value as string)}</>;
    case "datetime":
      return <>{dateTime(value as string)}</>;
    case "image":
      return <img src={mediaUrl(value as string)} alt="" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8 }} loading="lazy" />;
    case "file":
    case "url":
      return <a href={mediaUrl(value as string)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>Open</a>;
    case "int":
      return <>{field.optionLabels?.[String(value)] ?? String(value)}</>;
    case "text":
    case "richtext": {
      const text = String(value);
      return <>{text.length > 80 ? `${text.slice(0, 80)}…` : text}</>;
    }
    default:
      return <>{String(value)}</>;
  }
}
