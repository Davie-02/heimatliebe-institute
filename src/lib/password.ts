/**
 * The browser's copy of the password rules, so people see what's needed as they type.
 * The server (server/src/security/password-policy.ts) is the one that enforces them.
 */
export const PASSWORD_MIN_LENGTH = 10;

export function passwordChecks(password: string) {
  return [
    { label: `At least ${PASSWORD_MIN_LENGTH} characters`, ok: password.length >= PASSWORD_MIN_LENGTH },
    { label: "A lowercase letter", ok: /[a-z]/.test(password) },
    { label: "An uppercase letter", ok: /[A-Z]/.test(password) },
    { label: "A number", ok: /[0-9]/.test(password) },
  ];
}

export function passwordLooksStrong(password: string): boolean {
  return passwordChecks(password).every((check) => check.ok);
}
