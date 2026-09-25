import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Button, Check, ErrorNote, TextField } from "@/components/ui";
import { PasswordField } from "@/components/PasswordField";
import { SocialButtons } from "@/components/SocialButtons";
import { useAuth } from "@/context/AuthContext";
import { usePageMeta } from "@/hooks/useData";
import { api } from "@/services/api";
import type { SignInResult } from "@/lib/types";

type Step = { kind: "password" } | { kind: "two-factor"; challenge: string } | { kind: "password-change"; challenge: string; name: string };

/**
 * One sign-in for students and staff. Depending on the account it continues with the
 * authenticator code, or (first sign-in with an invitation) choosing a new password.
 */
export function SignInFlow({ endpoint = "/sign-in", owner = false }: { endpoint?: string; owner?: boolean }) {
  const { signedIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [step, setStep] = useState<Step>({ kind: "password" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const next = params.get("next") ?? (location.state as { from?: string } | null)?.from;

  async function finish(result: SignInResult) {
    if (result.kind === "two-factor") return setStep({ kind: "two-factor", challenge: result.challenge });
    if (result.kind === "password-change") return setStep({ kind: "password-change", challenge: result.challenge, name: result.name });
    await signedIn(result, remember);
    const home = result.kind === "staff" ? "/admin" : "/portal";
    navigate(next && next.startsWith(home) ? next : home, { replace: true });
  }

  async function run(work: () => Promise<SignInResult>) {
    setBusy(true);
    setError(null);
    try {
      await finish(await work());
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  const submitPassword = (e: FormEvent) => (e.preventDefault(), void run(() => api.post<SignInResult>(endpoint, { email, password, remember: owner ? undefined : remember })));
  const submitCode = (e: FormEvent) => (e.preventDefault(), step.kind === "two-factor" && void run(() => api.post<SignInResult>("/auth/login/2fa", { challenge: step.challenge, code })));
  const submitNewPassword = (e: FormEvent) => (e.preventDefault(), step.kind === "password-change" && void run(() => api.post<SignInResult>("/auth/first-password", { challenge: step.challenge, newPassword })));

  if (step.kind === "two-factor") {
    return (
      <form onSubmit={submitCode}>
        <h1>Two-step verification</h1>
        <p className="muted">Enter the 6-digit code from your authenticator app. Lost your phone? Use one of your recovery codes.</p>
        <ErrorNote error={error} />
        <TextField label="Code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
        <Button type="submit" className="btn-block" loading={busy}>Verify</Button>
        <button type="button" className="btn btn-ghost btn-block" onClick={() => setStep({ kind: "password" })}>Start again</button>
      </form>
    );
  }

  if (step.kind === "password-change") {
    return (
      <form onSubmit={submitNewPassword}>
        <h1>Welcome, {step.name.split(" ")[0]}</h1>
        <p className="muted">Choose your own password to finish setting up your account.</p>
        <ErrorNote error={error} />
        <PasswordField label="New password" value={newPassword} onChange={setNewPassword} isNew />
        <Button type="submit" className="btn-block" loading={busy}>Save and continue</Button>
      </form>
    );
  }

  return (
    <form onSubmit={submitPassword}>
      <h1>{owner ? "System administration" : "Sign in"}</h1>
      <p className="muted">{owner ? "For system administrators only." : "Students and staff sign in here."}</p>
      <ErrorNote error={error} />
      <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      <PasswordField label="Password" value={password} onChange={setPassword} />
      {!owner && <Check label="Keep me signed in on this device" checked={remember} onChange={(e) => setRemember(e.target.checked)} />}
      <Button type="submit" className="btn-block" size="lg" loading={busy}>Sign in</Button>
      <p className="small" style={{ textAlign: "center", marginTop: "1rem" }}>
        <Link to="/forgot-password">Forgot your password?</Link>
      </p>
      {!owner && <SocialButtons disabled={busy} onToken={(provider, token) => void run(() => api.post<SignInResult>("/sign-in/social", { provider, token, remember }))} />}
    </form>
  );
}

export default function SignIn() {
  const { session } = useAuth();
  usePageMeta("Sign in");
  if (session.kind === "staff") return <Navigate to="/admin" replace />;
  if (session.kind === "student") return <Navigate to="/portal" replace />;
  return (
    <div className="auth-shell">
      <div className="auth-card form-card page-enter">
        <SignInFlow />
        <p className="small muted" style={{ textAlign: "center", marginTop: "1.5rem" }}>
          New student? <Link to="/apply">Apply online</Link> — your portal opens when you're accepted.
        </p>
      </div>
    </div>
  );
}

export function OwnerSignIn() {
  usePageMeta("System administration");
  return (
    <div className="auth-shell">
      <div className="auth-card form-card page-enter">
        <SignInFlow endpoint="/auth/login" owner />
      </div>
    </div>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  usePageMeta("Forgot password");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/sign-in/forgot-password", { email });
      setSent(true);
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-shell">
      <div className="auth-card form-card page-enter">
        <h1>Forgot your password?</h1>
        {sent ? (
          <Alert tone="success">If an account uses that email, a reset link is on its way. It works for one hour. Check your spam folder too.</Alert>
        ) : (
          <form onSubmit={submit}>
            <p className="muted">Enter your email and we'll send you a link to choose a new password.</p>
            <ErrorNote error={error} />
            <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            <Button type="submit" className="btn-block" loading={busy}>Send reset link</Button>
          </form>
        )}
        <p className="small" style={{ textAlign: "center", marginTop: "1rem" }}><Link to="/sign-in">Back to sign in</Link></p>
      </div>
    </div>
  );
}

/** Used both for password reset links and for new students' "choose your password" invitation. */
export function ResetPassword({ invite }: { invite?: boolean }) {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  usePageMeta(invite ? "Choose your password" : "Reset password");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(invite ? "/sign-in/set-password" : "/sign-in/reset-password", { token, newPassword: password });
      setDone(true);
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-shell">
      <div className="auth-card form-card page-enter">
        <h1>{invite ? "Welcome! Choose your password" : "Choose a new password"}</h1>
        {!token ? (
          <Alert tone="danger">This link is incomplete. Open it again from your email.</Alert>
        ) : done ? (
          <>
            <Alert tone="success">Your password is set. You can sign in now.</Alert>
            <Link to="/sign-in" className="btn btn-block">Sign in</Link>
          </>
        ) : (
          <form onSubmit={submit}>
            <ErrorNote error={error} />
            <PasswordField label="New password" value={password} onChange={setPassword} isNew />
            <Button type="submit" className="btn-block" loading={busy}>Save password</Button>
          </form>
        )}
      </div>
    </div>
  );
}
