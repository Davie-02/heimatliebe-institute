import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, onUnauthorized } from "@/services/api";
import { clearFallbackToken, settleSession } from "@/services/session";
import type { SignInResult, StaffUser, StudentUser } from "@/lib/types";

type Session = { kind: "staff"; user: StaffUser } | { kind: "student"; user: StudentUser } | { kind: "none" };

interface AuthValue {
  session: Session;
  checking: boolean;
  /** Stores the result of a successful sign-in (cookie check + fallback token). */
  signedIn: (result: Extract<SignInResult, { kind: "staff" | "student" }>, remember: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  setStaff: (user: StaffUser) => void;
}

const AuthContext = createContext<AuthValue>(null as unknown as AuthValue);
/** Remembers which kind of account signed in on this device, so public pages don't ask the server on every visit. */
const HINT = "hml_realm";

function readHint(): string | null {
  try {
    return localStorage.getItem(HINT);
  } catch {
    return null;
  }
}
function writeHint(value: string | null) {
  try {
    if (value) localStorage.setItem(HINT, value);
    else localStorage.removeItem(HINT);
  } catch {
    // ignore
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ kind: "none" });
  const [checking, setChecking] = useState(true);

  const refresh = useCallback(async () => {
    const hint = readHint();
    const onPrivatePage = /^\/(admin|portal)/.test(window.location.pathname);
    if (!hint && !onPrivatePage) {
      setChecking(false);
      return;
    }
    try {
      if (hint !== "student") {
        try {
          const { user } = await api.get<{ user: StaffUser }>("/auth/session", { quiet401: true });
          setSession({ kind: "staff", user });
          writeHint("staff");
          return;
        } catch {
          // not staff
        }
      }
      try {
        const { user } = await api.get<{ user: StudentUser }>("/student-auth/session", { quiet401: true });
        setSession({ kind: "student", user });
        writeHint("student");
        return;
      } catch {
        // not a student either
      }
      setSession({ kind: "none" });
      writeHint(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return onUnauthorized(() => {
      setSession({ kind: "none" });
      writeHint(null);
    });
  }, [refresh]);

  const signedIn = useCallback(async (result: Extract<SignInResult, { kind: "staff" | "student" }>, remember: boolean) => {
    await settleSession(result.token, result.kind === "staff" ? "/auth/session" : "/student-auth/session", remember);
    writeHint(result.kind);
    setSession(result.kind === "staff" ? { kind: "staff", user: result.user } : { kind: "student", user: result.user });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // signing out locally is what matters
    }
    clearFallbackToken();
    writeHint(null);
    setSession({ kind: "none" });
  }, []);

  const setStaff = useCallback((user: StaffUser) => setSession({ kind: "staff", user }), []);

  return <AuthContext.Provider value={{ session, checking, signedIn, signOut, refresh, setStaff }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/** The signed-in staff member (only use inside the workspace, where one is guaranteed). */
export function useStaff(): StaffUser {
  const { session } = useAuth();
  if (session.kind !== "staff") throw new Error("Not signed in as staff");
  return session.user;
}

export function useStudent(): StudentUser {
  const { session } = useAuth();
  if (session.kind !== "student") throw new Error("Not signed in as a student");
  return session.user;
}
