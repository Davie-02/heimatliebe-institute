import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { Request } from "express";
import { readCookie } from "./cookies";
import { STAFF_SESSION_COOKIE, STUDENT_SESSION_COOKIE } from "./session-cookie";

/**
 * CSRF protection.
 *
 * The threat: while you are signed in, a malicious page tricks your browser into sending a
 * request to us, and the browser helpfully attaches your session cookie. The defence: every
 * state-changing request must also carry a secret token in a header that a malicious page
 * cannot obtain (browsers stop other sites reading our API's responses — see CORS in main.ts).
 *
 * Tokens are SIGNED rather than remembered: `nonce.expiry.signature`, where the signature is an
 * HMAC of the first two parts under JWT_SECRET. The server verifies one without storing anything
 * and without any cookie, so it also works in browsers that block third-party cookies.
 */

export const CSRF_HEADER = "x-csrf-token";
const CSRF_LIFETIME_MS = 2 * 60 * 60 * 1000;

function signingKey(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET must be configured.");
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(`csrf:${payload}`).digest("hex");
}

export function createCsrfToken(now: number = Date.now()): string {
  const payload = `${randomBytes(16).toString("hex")}.${now + CSRF_LIFETIME_MS}`;
  return `${payload}.${sign(payload)}`;
}

/** Signature genuine and not expired? */
export function isValidSignedCsrfToken(token: string, now: number = Date.now()): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [nonce, expiry, signature] = parts;

  const expected = Buffer.from(sign(`${nonce}.${expiry}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;

  return Number(expiry) > now;
}

export function hasValidCsrfToken(request: Request): boolean {
  const header = request.headers[CSRF_HEADER];
  const token = Array.isArray(header) ? header[0] : header;
  return typeof token === "string" && token.length > 0 && isValidSignedCsrfToken(token);
}

const AUTH_FORM_PATH = /\/(login|login\/2fa|sign-in(\/[a-z-]+)?|first-password|set-password|forgot-password|reset-password)\/?$/;

/**
 * CSRF only matters when the browser would attach credentials on its own: a session cookie.
 * A request with no session (a visitor sending an enquiry, taking the placement test, asking the
 * assistant) has nothing for another site to hijack, so demanding the token there would only add
 * failure modes. Sign-in, password and invitation forms stay protected regardless.
 */
export function csrfCheckRequired(request: Request): boolean {
  const cookieHeader = request.headers.cookie;
  const hasSession =
    Boolean(readCookie(cookieHeader, STAFF_SESSION_COOKIE)) || Boolean(readCookie(cookieHeader, STUDENT_SESSION_COOKIE));
  return hasSession || AUTH_FORM_PATH.test(request.path);
}
