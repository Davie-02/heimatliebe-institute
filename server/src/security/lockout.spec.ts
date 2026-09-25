import { LOCK_DURATION_MS, MAX_FAILED_ATTEMPTS, isLocked, lockedMessage, recordUnknownEmailFailure, stateAfterFailure, unknownEmailLockedUntil } from "./lockout";

describe("lockout", () => {
  const now = new Date("2026-01-01T12:00:00Z");

  it("counts failures without locking until the limit", () => {
    expect(stateAfterFailure(0, now)).toEqual({ failedLoginCount: 1, lockedUntil: null });
    expect(stateAfterFailure(MAX_FAILED_ATTEMPTS - 2, now).lockedUntil).toBeNull();
  });

  it("locks on the final allowed failure and restarts the count", () => {
    const state = stateAfterFailure(MAX_FAILED_ATTEMPTS - 1, now);
    expect(state.failedLoginCount).toBe(0);
    expect(state.lockedUntil?.getTime()).toBe(now.getTime() + LOCK_DURATION_MS);
  });

  it("treats a past lock as expired", () => {
    expect(isLocked(new Date(now.getTime() + 1000), now)).toBe(true);
    expect(isLocked(new Date(now.getTime() - 1000), now)).toBe(false);
    expect(isLocked(null, now)).toBe(false);
  });

  it("words the wait in minutes, rounding up", () => {
    expect(lockedMessage(new Date(now.getTime() + 30_000), now)).toContain("1 minute,");
    expect(lockedMessage(new Date(now.getTime() + 14 * 60_000 + 1), now)).toContain("15 minutes");
  });
});

describe("lockout for emails with no account", () => {
  it("locks unknown emails after the same number of attempts, so lockout reveals nothing", () => {
    const email = `nobody-${Date.now()}@example.org`;
    const now = new Date("2026-09-25T10:00:00Z");
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) expect(recordUnknownEmailFailure(email, now)).toBeNull();
    const lock = recordUnknownEmailFailure(email, now);
    expect(lock).not.toBeNull();
    expect(unknownEmailLockedUntil(email.toUpperCase(), now)).toEqual(lock);
    // After the lock ends, counting starts again.
    const later = new Date(now.getTime() + LOCK_DURATION_MS + 1000);
    expect(unknownEmailLockedUntil(email, later)).toBeNull();
    expect(recordUnknownEmailFailure(email, later)).toBeNull();
  });
});
