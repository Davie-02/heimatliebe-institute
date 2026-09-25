import type { CookieOptions, Response } from "express";

/**
 * Session cookies and how long a sign-in lasts.
 *
 * A sign-in is a signed token (JWT). It travels two ways, and the server
 * accepts either (see jwt-auth.guard.ts):
 *   1. an HttpOnly cookie set here — the normal, safest route, because page
 *      scripts can never read it; and
 *   2. an `Authorization: Bearer` header — the fallback used automatically
 *      when a browser refuses to keep cookies from our API's domain (Safari,
 *      Firefox strict mode, some in-app browsers). See src/services/sessionToken.ts.
 */

export const STAFF_SESSION_COOKIE = "hml_staff_session";
export const STUDENT_SESSION_COOKIE = "hml_student_session";

export function parseDurationMs(duration: string, fallbackMs: number): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)$/i.exec(duration.trim());
  if (!match) return fallbackMs;

  const unitMs: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return Number(match[1]) * unitMs[match[2].toLowerCase()];
}

/**
 * How long a sign-in lasts.
 *  - Normal: JWT_EXPIRES_IN (default 8 hours, a school day). The cookie is a *session*
 *    cookie, so the browser also drops it when it is closed.
 *  - "Keep me signed in": REMEMBER_ME_EXPIRES_IN (default 30 days), stored as
 *    a persistent cookie that survives closing the browser.
 * The token's own expiry always matches, so a cookie never outlives the token
 * inside it (which would show as a confusing "session expired" mid-task).
 */
export function sessionLifetimeMs(remember: boolean): number {
  return remember
    ? parseDurationMs(process.env.REMEMBER_ME_EXPIRES_IN || "30d", 30 * 24 * 3600 * 1000)
    : parseDurationMs(process.env.JWT_EXPIRES_IN || "8h", 8 * 3600 * 1000);
}

/**
 * Attributes every session cookie shares.
 *
 * In production the site and API are on different domains, so the cookie has
 * to be `SameSite=None; Secure` to be sent at all. When the site is served
 * through the same domain as the API (the Vercel rewrite in DEPLOYMENT.md),
 * the cookie is first-party and works in every browser. COOKIE_SAMESITE can
 * force "lax" or "strict" for that setup; the default is safe for both.
 */
export function baseCookieOptions(): CookieOptions {
  const isProduction = process.env.NODE_ENV === "production";
  const override = (process.env.COOKIE_SAMESITE ?? "").toLowerCase();
  const sameSite = override === "lax" || override === "strict" || override === "none" ? override : isProduction ? "none" : "lax";

  return {
    httpOnly: true,
    // SameSite=None is only honoured together with Secure.
    secure: isProduction || sameSite === "none",
    sameSite,
    path: "/",
  };
}

/**
 * Stores the session token in the browser.
 * @param maxAgeMs omit for a browser-session cookie (dies when the browser closes)
 */
export function setSessionCookie(response: Response, name: string, token: string, maxAgeMs?: number): void {
  response.cookie(name, token, maxAgeMs ? { ...baseCookieOptions(), maxAge: maxAgeMs } : baseCookieOptions());
}

export function clearSessionCookie(response: Response, name: string): void {
  // clearCookie ignores maxAge and expires the cookie immediately, so only the
  // matching attributes (path, sameSite, secure) are needed for the browser to
  // find and remove the right cookie.
  response.clearCookie(name, baseCookieOptions());
}
