import { useEffect, useId, useState, type FormEvent } from "react";
import { Button, Check, ErrorNote, Field } from "@/components/ui";
import { FileField } from "@/components/FileField";
import { useDebounced } from "@/hooks/useData";
import { api, ApiError } from "@/services/api";
import { humanize, toDateInput, toDateTimeInput } from "@/lib/format";
import type { FieldDef, ResourceSchema } from "./SchemaContext";

type Values = Record<string, unknown>;

/** Search-as-you-type picker for a linked record (a student, a class, a teacher…). */
export function RefPicker({ field, value, onChange, initialLabel }: { field: FieldDef; value: string | null; onChange: (id: string | null) => void; initialLabel?: string }) {
  const id = useId();
  const [q, setQ] = useState("");
  const [label, setLabel] = useState(initialLabel ?? "");
  const [options, setOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(q, 200);
  const path = field.ref === "staff" ? "/staff-accounts/options" : `/r/${field.ref}/options`;

  useEffect(() => {
    if (value && !label) {
      api.get<Array<{ id: string; label?: string; name?: string }>>(field.ref === "staff" ? path : `${path}?ids=${value}`)
        .then((rows) => {
          const match = rows.find((r) => r.id === value);
          if (match) setLabel(match.label ?? match.name ?? value);
        })
        .catch(() => undefined);
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    api.get<Array<{ id: string; label?: string; name?: string }>>(`${path}?q=${encodeURIComponent(debounced)}`)
      .then((rows) => setOptions(rows.map((r) => ({ id: r.id, label: r.label ?? r.name ?? r.id }))))
      .catch(() => setOptions([]));
  }, [debounced, open, path]);

  return (
    <div style={{ position: "relative" }}>
      <input
        id={id}
        className="input"
        value={open ? q : label}
        placeholder={label || "Type to search…"}
        onFocus={() => { setOpen(true); setQ(""); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setQ(e.target.value)}
        aria-label={field.label}
      />
      {open && (
        <div className="search-results">
          {!field.required && value && <a href="#" onMouseDown={(e) => { e.preventDefault(); onChange(null); setLabel(""); setOpen(false); }}><span className="muted">None</span></a>}
          {options.map((o) => (
            <a key={o.id} href="#" onMouseDown={(e) => { e.preventDefault(); onChange(o.id); setLabel(o.label); setOpen(false); }}>{o.label}</a>
          ))}
          {!options.length && <p className="muted small" style={{ padding: ".5rem" }}>No matches.</p>}
        </div>
      )}
    </div>
  );
}

/** Turns a stored value into what a form input shows. */
function toInput(field: FieldDef, value: unknown): unknown {
  if (value === null || value === undefined) return field.type === "bool" ? false : "";
  if (field.type === "date") return toDateInput(value as string);
  if (field.type === "datetime") return toDateTimeInput(value as string);
  return value;
}

/** Turns what a form input holds into what the API expects. */
function fromInput(field: FieldDef, value: unknown): unknown {
  if (value === "" || value === undefined) return null;
  if (field.type === "datetime") return new Date(value as string).toISOString();
  if ((field.type === "int" || field.type === "number" || field.type === "money") && typeof value === "string") return Number(value);
  return value;
}

export function FieldInput({ field, value, onChange, error, record }: { field: FieldDef; value: unknown; onChange: (value: unknown) => void; error?: string; record?: Values }) {
  const id = useId();
  const common = { id, "aria-invalid": error ? true : undefined, required: field.required } as const;
  if (field.type === "bool") return <Check label={field.label} checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
  if (field.type === "image" || field.type === "file") {
    return <FileField label={field.label} value={(value as string) || null} onChange={onChange} accept={field.type === "image" ? "image/*" : undefined} hint={field.help} required={field.required} />;
  }
  let input;
  switch (field.type) {
    case "text":
    case "richtext":
      input = <textarea {...common} className="textarea" rows={field.type === "richtext" ? 10 : 4} value={value as string} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "enum":
      input = (
        <select {...common} className="select" value={value as string} onChange={(e) => onChange(e.target.value)}>
          {!field.required && <option value="">—</option>}
          {field.options?.map((o) => <option key={o} value={o}>{field.optionLabels?.[o] ?? humanize(o)}</option>)}
        </select>
      );
      break;
    case "ref": {
      const relation = field.relation ? (record?.[field.relation] as Record<string, unknown> | undefined) : undefined;
      const initial = relation ? String(relation.name ?? relation.title ?? relation.invoiceNo ?? relation.id ?? "") : undefined;
      input = <RefPicker field={field} value={(value as string) || null} onChange={onChange} initialLabel={initial} />;
      break;
    }
    case "int":
    case "number":
    case "money":
      input = field.options ? (
        <select {...common} className="select" value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {!field.required && <option value="">—</option>}
          {field.options.map((o) => <option key={o} value={o}>{field.optionLabels?.[o] ?? o}</option>)}
        </select>
      ) : (
        <input {...common} className="input" type="number" inputMode="decimal" step={field.type === "int" ? 1 : "any"} min={field.min} max={field.max} value={value as string} onChange={(e) => onChange(e.target.value)} />
      );
      break;
    default: {
      const type = { email: "email", phone: "tel", url: "url", date: "date", datetime: "datetime-local", time: "time" }[field.type as string] ?? "text";
      input = <input {...common} className="input" type={type} value={value as string} onChange={(e) => onChange(e.target.value)} />;
    }
  }
  return (
    <Field label={field.label} hint={field.help} error={error} required={field.required} htmlFor={id} className={field.type === "text" || field.type === "richtext" ? "span-all" : ""}>
      {input}
    </Field>
  );
}

/**
 * The add/edit form for any record, built from its description. Only editable fields are shown and
 * only changed fields are sent, so two people editing different fields don't overwrite each other.
 */
export function RecordForm({ schema, record, onSaved, onCancel, presets = {} }: { schema: ResourceSchema; record?: Values; onSaved: (row: Values) => void; onCancel?: () => void; presets?: Values }) {
  const editable = schema.fields.filter((f) => !f.readOnly && !f.hidden);
  const initial = () => Object.fromEntries(editable.map((f) => [f.name, toInput(f, record ? record[f.name] : presets[f.name] ?? f.default)]));
  const [values, setValues] = useState<Values>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const start = initial();
      const body = Object.fromEntries(
        editable.filter((f) => !record || JSON.stringify(values[f.name]) !== JSON.stringify(start[f.name])).map((f) => [f.name, fromInput(f, values[f.name])])
      );
      const row = record ? await api.patch<Values>(`/r/${schema.key}/${record.id}`, body) : await api.post<Values>(`/r/${schema.key}`, body);
      onSaved(row);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      {error && !error.fields && <ErrorNote error={error} />}
      {error?.fields && <ErrorNote error={new Error(error.message)} />}
      <div className="form-grid">
        {editable.map((field) => (
          <FieldInput key={field.name} field={field} value={values[field.name]} record={record} error={error?.fields?.[field.name]} onChange={(v) => setValues((current) => ({ ...current, [field.name]: v }))} />
        ))}
      </div>
      <div className="form-actions">
        {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" loading={busy}>{record ? "Save changes" : `Add ${schema.singular.toLowerCase()}`}</Button>
      </div>
    </form>
  );
}
