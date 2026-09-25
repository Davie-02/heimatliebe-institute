/**
 * Cookie-free sign-in fallback.
 *
 * Normally signing in sets an HttpOnly cookie that page scripts never see. When the website and
 * API are on different domains, some browsers (Safari, private windows, in-app browsers) refuse
 * that cookie. Right after signing in we check whether the cookie works; if it doesn't, we keep the
 * token the server also returned and send it as an `Authorization: Bearer` header instead.
 * With the same-domain setup on Vercel (see vercel.json) the cookie always works and this stays unused.
 */
const KEY = "hml_session_token";
const API = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001/api";

function read(storage: () => Storage): string | null {
  try {
    return storage().getItem(KEY);
  } catch {
    return null;
  }
}

export function fallbackToken(): string | null {
  return read(() => sessionStorage) ?? read(() => localStorage);
}

export function clearFallbackToken(): void {
  try {
    sessionStorage.removeItem(KEY);
    localStorage.removeItem(KEY);
  } catch {
    // storage blocked: nothing to clear
  }
}

export function authHeader(): Record<string, string> {
  const token = fallbackToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Call once after a successful sign-in with the token and the realm's "who am I" address. */
export async function settleSession(token: string | undefined, sessionPath: string, remember: boolean): Promise<void> {
  clearFallbackToken();
  if (!token) return;
  try {
    const response = await fetch(`${API}${sessionPath}`, { credentials: "include" });
    if (response.ok) return; // the cookie works
  } catch {
    // fall through to header mode
  }
  try {
    (remember ? localStorage : sessionStorage).setItem(KEY, token);
  } catch {
    // storage blocked as well; the person will simply be asked to sign in again
  }
}
