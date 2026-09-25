import { useEffect, useState, type FormEvent } from "react";
import { Alert, Button, ErrorNote, PageHead, TextField } from "@/components/ui";
import { useToast } from "@/components/Toasts";
import { useAuth, useStaff } from "@/context/AuthContext";
import { usePageMeta } from "@/hooks/useData";
import { api } from "@/services/api";
import { PasswordCard } from "../shared/Security";
import type { StaffUser } from "@/lib/types";

/** Two-step verification with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…). */
function TwoFactorCard() {
  const user = useStaff();
  const { setStaff } = useAuth();
  const toast = useToast();
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!setup) return;
    // The QR library is only downloaded when someone sets up two-step verification.
    import("qrcode").then((QR) => QR.toDataURL(setup.otpauthUri, { margin: 1, width: 200 })).then(setQr).catch(() => setQr(null));
  }, [setup]);

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      setSetup(await api.post("/auth/2fa/setup"));
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }
  async function enable(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ recoveryCodes: string[] }>("/auth/2fa/enable", { code });
      setCodes(result.recoveryCodes);
      setSetup(null);
      toast("Two-step verification is on.");
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }
  /** Only now refresh who we are: for administrators this opens the full workspace, which would hide the codes. */
  async function savedCodes() {
    setCodes(null);
    const { user: fresh } = await api.get<{ user: StaffUser }>("/auth/session");
    setStaff(fresh);
  }

  async function disable(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/2fa/disable", { password, code });
      const { user: fresh } = await api.get<{ user: StaffUser }>("/auth/session");
      setStaff(fresh);
      setCode("");
      setPassword("");
      toast("Two-step verification is off.");
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Two-step verification {user.twoFactorEnabled ? <span className="badge badge-success">On</span> : <span className="badge">Off</span>}</h2>
      <p className="muted">After your password, you'll also type a 6-digit code from an app on your phone. Someone who learns your password still can't get in.</p>
      <ErrorNote error={error} />
      {codes && (
        <>
          <Alert tone="warning">Save these recovery codes somewhere safe (print them or write them down). Each works once if you lose your phone. They won't be shown again.</Alert>
          <div className="codes">{codes.map((c) => <span key={c}>{c}</span>)}</div>
          <div className="form-actions"><Button variant="outline" icon="printer" onClick={() => window.print()}>Print</Button><Button onClick={() => void savedCodes()}>I've saved them</Button></div>
        </>
      )}
      {!codes && !user.twoFactorEnabled && !setup && <Button icon="shield" loading={busy} onClick={() => void begin()}>Set up two-step verification</Button>}
      {setup && (
        <form onSubmit={enable} className="stack">
          <ol className="small">
            <li>Install an authenticator app (Google Authenticator, Microsoft Authenticator or Authy).</li>
            <li>Scan this code with the app, or type the key below.</li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          {qr ? <img className="qr" src={qr} alt="QR code for your authenticator app" /> : null}
          <p className="small">Key: <span className="mono">{setup.secret.match(/.{1,4}/g)?.join(" ")}</span></p>
          <TextField label="Code from the app" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
          <div className="form-actions"><Button type="submit" loading={busy}>Turn on</Button></div>
        </form>
      )}
      {!codes && user.twoFactorEnabled && user.role !== "OWNER" && (
        <form onSubmit={disable}>
          <p className="small muted">To turn it off, confirm with your password and a current code.</p>
          <div className="form-grid">
            <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <TextField label="Code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} required />
          </div>
          <div className="form-actions"><Button type="submit" variant="outline" loading={busy}>Turn off</Button></div>
        </form>
      )}
      {user.twoFactorEnabled && user.role === "OWNER" && <p className="small muted">System administrators must keep two-step verification on.</p>}
    </section>
  );
}

export default function StaffSecurity() {
  const user = useStaff();
  usePageMeta("My security");
  return (
    <>
      <PageHead title="My security" />
      {user.mustSetUpTwoFactor && <Alert tone="warning">As a system administrator you must turn on two-step verification before using the workspace.</Alert>}
      <div className="grid-2">
        <TwoFactorCard />
        <PasswordCard />
      </div>
    </>
  );
}
