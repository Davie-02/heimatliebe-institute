import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";
import { humanize, initials, statusTone } from "@/lib/format";
import { mediaUrl } from "@/services/api";

/* Small building blocks used on every page. */

export function Button({ loading, icon, variant = "", size = "", children, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; icon?: IconName; variant?: "" | "gold" | "outline" | "ghost" | "danger" | "light"; size?: "" | "sm" | "lg" }) {
  return (
    <button className={`btn ${variant ? `btn-${variant}` : ""} ${size ? `btn-${size}` : ""} ${className}`} disabled={loading || rest.disabled} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spinner" aria-hidden /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, required, children, className = "", htmlFor }: { label: ReactNode; hint?: ReactNode; error?: string; required?: boolean; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={`field ${className}`}>
      <label className={required ? "required" : ""} htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="error" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

type Labelled = { label: ReactNode; hint?: ReactNode; error?: string; className?: string };

export function TextField({ label, hint, error, className, ...rest }: Labelled & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} required={rest.required} className={className} htmlFor={id}>
      <input id={id} className="input" aria-invalid={error ? true : undefined} {...rest} />
    </Field>
  );
}

export function TextArea({ label, hint, error, className, ...rest }: Labelled & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} required={rest.required} className={className} htmlFor={id}>
      <textarea id={id} className="textarea" aria-invalid={error ? true : undefined} {...rest} />
    </Field>
  );
}

export function SelectField({ label, hint, error, className, options, placeholder, ...rest }: Labelled & SelectHTMLAttributes<HTMLSelectElement> & { options: Array<string | { value: string; label: string }>; placeholder?: string }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} required={rest.required} className={className} htmlFor={id}>
      <select id={id} className="select" aria-invalid={error ? true : undefined} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (typeof o === "string" ? <option key={o} value={o}>{humanize(o)}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
    </Field>
  );
}

export function Check({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}

export function Status({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="faint">—</span>;
  const tone = statusTone(value);
  return <span className={`badge ${tone ? `badge-${tone}` : ""}`}>{humanize(value)}</span>;
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function Empty({ icon = "inbox", title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <strong>{title}</strong>
      {children && <div className="small">{children}</div>}
    </div>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "danger" | "warning" | "success"; children: ReactNode }) {
  const icon: IconName = tone === "danger" ? "alert" : tone === "success" ? "check-circle" : "info";
  return (
    <div className={`alert ${tone !== "info" ? `alert-${tone}` : ""}`} role={tone === "danger" ? "alert" : "status"}>
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <Alert tone="danger">{error instanceof Error ? error.message : String(error)}</Alert>;
}

export function Avatar({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  const style = { width: size, height: size };
  return src ? <img className="avatar" src={mediaUrl(src)} alt="" style={style} loading="lazy" /> : <span className="avatar" style={style} aria-hidden>{initials(name)}</span>;
}

/** Accessible dialog: focus moves in, Escape closes, the page behind can't scroll. */
export function Modal({ title, onClose, children, wide, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not(.dialog-close)");
    (first ?? ref.current)?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`dialog ${wide ? "dialog-wide" : ""}`} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} ref={ref} tabIndex={-1}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="icon-btn dialog-close" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        {children}
        {footer && <div className="form-actions">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export function Confirm({ title, message, confirmLabel = "Confirm", danger, onConfirm, onClose, busy }: { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void; busy?: boolean }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? "danger" : ""} loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="muted">{message}</div>
    </Modal>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ value: T; label: ReactNode }>; value: T; onChange: (value: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button key={tab.value} className="tab" role="tab" aria-selected={tab.value === value} onClick={() => onChange(tab.value)}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total ? <div className="pagination"><span>{total} record{total === 1 ? "" : "s"}</span></div> : null;
  return (
    <div className="pagination">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="row">
        <Button variant="outline" size="sm" icon="chevron-left" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next <Icon name="chevron-right" />
        </Button>
      </div>
    </div>
  );
}

export function PageHead({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}
