import { useId, useState } from "react";
import { Icon } from "./Icon";
import { passwordChecks } from "@/lib/password";

/** Password input with show/hide and, for new passwords, the live checklist of rules. */
export function PasswordField({ label, value, onChange, isNew, autoComplete, error }: { label: string; value: string; onChange: (value: string) => void; isNew?: boolean; autoComplete?: string; error?: string }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id} className="required">{label}</label>
      <div style={{ position: "relative" }}>
        <input id={id} className="input" type={shown ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete ?? (isNew ? "new-password" : "current-password")} required style={{ paddingRight: "3rem" }} aria-invalid={error ? true : undefined} />
        <button type="button" className="icon-btn" onClick={() => setShown((s) => !s)} aria-label={shown ? "Hide password" : "Show password"} style={{ position: "absolute", right: 2, top: 2 }}>
          <Icon name={shown ? "eye" : "lock"} />
        </button>
      </div>
      {error && <span className="error">{error}</span>}
      {isNew && (
        <ul className="list small" style={{ marginTop: ".25rem" }}>
          {passwordChecks(value).map((check) => (
            <li key={check.label} style={{ padding: ".15rem 0", border: 0, justifyContent: "flex-start", color: check.ok ? "var(--success)" : "var(--muted)" }}>
              <Icon name={check.ok ? "check-circle" : "check"} /> {check.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
