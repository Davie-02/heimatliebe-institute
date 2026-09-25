import { createHash } from "crypto";

/**
 * Account lockout after repeated wrong passwords.
 *
 * The per-IP rate limit (@Throttle on the login routes) stops one machine
 * hammering the form; lockout additionally stops a spread-out attack aimed at
 * a single account. Both staff and student sign-in use these helpers so the
 * rule is defined once.
 *
 * State lives on the user row (failedLoginCount, lockedUntil).
 */

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 15 * 60 * 1000;

export interface LockState {
  failedLoginCount: number;
  lockedUntil: Date | null;
}

/** Is the account currently locked? A lock in the past has simply expired. */
export function isLocked(lockedUntil: Date | null | undefined, now: Date = new Date()): boolean {
  return Boolean(lockedUntil && lockedUntil.getTime() > now.getTime());
}

/** Wording shown to the person who is locked out. Says how long, and offers the way out. */
export function lockedMessage(lockedUntil: Date, now: Date = new Date()): string {
  const minutes = Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 60000));
  return `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or reset your password.`;
}

/**
 * The counters to save after one more wrong password. Reaching the limit
 * sets the lock and restarts the count, so when the lock ends the person
 * gets a fresh set of attempts rather than being locked again by the very
 * next typo.
 */
export function stateAfterFailure(currentCount: number, now: Date = new Date()): LockState {
  const next = currentCount + 1;
  if (next >= MAX_FAILED_ATTEMPTS) {
    return { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCK_DURATION_MS) };
  }
  return { failedLoginCount: next, lockedUntil: null };
}

/** The counters after a successful sign-in: everything forgiven. */
export const CLEARED_LOCK_STATE: LockState = { failedLoginCount: 0, lockedUntil: null };

/**
 * Lockout for email addresses that have NO account. Without this, "Too many
 * failed sign-in attempts" would only ever appear for real accounts, so
 * trying five wrong passwords would reveal whether an email is registered.
 * Unknown emails are counted here (in memory, by a hash of the address) and
 * locked the same way, so both cases look identical from outside.
 */

const unknownFailures = new Map<string, LockState>();

function unknownKey(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

/** The lock currently applying to an address with no account, if any. */
export function unknownEmailLockedUntil(email: string, now: Date = new Date()): Date | null {
  const state = unknownFailures.get(unknownKey(email));
  return state?.lockedUntil && isLocked(state.lockedUntil, now) ? state.lockedUntil : null;
}

/** Counts one more wrong attempt for an address with no account. Returns the lock if it just started. */
export function recordUnknownEmailFailure(email: string, now: Date = new Date()): Date | null {
  const key = unknownKey(email);
  const current = unknownFailures.get(key);
  const count = current?.lockedUntil && !isLocked(current.lockedUntil, now) ? 0 : current?.failedLoginCount ?? 0;
  const next = stateAfterFailure(count, now);
  unknownFailures.set(key, next);
  if (unknownFailures.size > 20_000) unknownFailures.clear();
  return next.lockedUntil;
}
