import { useId, useState } from "react";
import { uploadFile, mediaUrl } from "@/services/api";
import { Icon } from "./Icon";

/**
 * Upload a file and keep its address in a form. Photos are shrunk on the server, so a phone
 * picture uploads quickly even on a slow connection.
 */
export function FileField({ label, value, onChange, realm = "staff", accept, hint, isPrivate, required }: {
  label: string;
  value?: string | null;
  onChange: (url: string | null) => void;
  realm?: "staff" | "student" | "public";
  accept?: string;
  hint?: string;
  isPrivate?: boolean;
  required?: boolean;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isImage = value && /\.(webp|png|jpe?g|gif)(\?|$)/i.test(value);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await uploadFile(file, realm, isPrivate);
      onChange(result.url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <label htmlFor={id} className={required ? "required" : ""}>{label}</label>
      <div className="row">
        {isImage && <img src={mediaUrl(value)} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8 }} />}
        {value && !isImage && <a href={mediaUrl(value)} target="_blank" rel="noopener noreferrer" className="small"><Icon name="paperclip" /> Attached file</a>}
        <label className="btn btn-outline btn-sm" style={{ cursor: busy ? "wait" : "pointer" }}>
          {busy ? <span className="spinner" /> : <Icon name="upload" />}
          {value ? "Replace" : "Choose file"}
          <input id={id} type="file" hidden accept={accept} onChange={(e) => void pick(e.target.files?.[0])} disabled={busy} />
        </label>
        {value && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)}>Remove</button>}
      </div>
      {error ? <span className="error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}
