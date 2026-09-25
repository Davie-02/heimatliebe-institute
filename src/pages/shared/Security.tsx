import { useState, type FormEvent } from "react";
import { Alert, Button, ErrorNote, PageHead } from "@/components/ui";
import { PasswordField } from "@/components/PasswordField";
import { useToast } from "@/components/Toasts";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/services/api";
import { settleSession } from "@/services/session";
import type { SignInResult } from "@/lib/types";

/** Change password and "sign out everywhere" — for students and staff. Staff also get two-step verification (TwoFactorCard). */
export function PasswordCard() {
  const { session, signedIn } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const base = session.kind === "staff" ? "/auth" : "/student-auth";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<Extract<SignInResult, { kind: "staff" | "student" }>>(`${base}/change-password`, { currentPassword: current, newPassword: next });
      await signedIn(result, false);
      setCurrent("");
      setNext("");
      toast("Password changed. Other devices have been signed out.");
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  async function everywhere() {
    setBusy(true);
    try {
      const result = await api.post<Extract<SignInResult, { kind: "staff" | "student" }>>(`${base}/sign-out-everywhere`);
      await settleSession(result.token, `${base}/session`, false);
      toast("Every other device has been signed out.");
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="card" onSubmit={submit}>
        <h2>Change password</h2>
        <ErrorNote error={error} />
        <PasswordField label="Current password" value={current} onChange={setCurrent} />
        <PasswordField label="New password" value={next} onChange={setNext} isNew />
        <div className="form-actions"><Button type="submit" loading={busy} disabled={!current || !next}>Change password</Button></div>
      </form>
      <div className="card">
        <h2>Signed in somewhere else?</h2>
        <p className="muted">If you lost a phone or used a shared computer, sign out of every other device. This device stays signed in.</p>
        <Button variant="outline" icon="log-out" loading={busy} onClick={() => void everywhere()}>Sign out everywhere else</Button>
      </div>
    </>
  );
}

export default function StudentSecurity() {
  return (
    <>
      <PageHead title="Password & security" />
      <Alert>Never share your password. Staff will never ask for it.</Alert>
      <div className="grid-2"><PasswordCard /></div>
    </>
  );
}
