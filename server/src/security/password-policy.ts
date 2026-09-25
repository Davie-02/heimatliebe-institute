import { registerDecorator, type ValidationArguments, type ValidationOptions } from "class-validator";

/**
 * The single definition of what counts as an acceptable NEW password on the
 * server. It is applied whenever a password is created or changed (student
 * sign-up, password reset, change password, admin account creation) and is
 * deliberately NOT applied at sign-in, so people whose password was set under
 * the older, looser rule can still get in and then upgrade it.
 *
 * The browser has a mirror of these rules (src/utils/password.ts) so people
 * see the requirements as they type; this file is the one that actually
 * enforces them, because anything in the browser can be bypassed.
 */

export const PASSWORD_MIN_LENGTH = 10;

/** bcrypt silently ignores everything after 72 bytes, so longer passwords give a false sense of security. */
export const PASSWORD_MAX_BYTES = 72;

/**
 * The passwords attackers try first. Not exhaustive — it is a cheap first
 * filter for the worst offenders (compared lower-cased, with digits/symbols
 * stripped from the ends, see isCommonPassword).
 */
const COMMON_PASSWORDS = new Set([
  "password", "passw0rd", "password1", "password12", "password123", "letmein", "welcome", "welcome1",
  "qwerty", "qwertyuiop", "qwerty123", "abc123", "abcd1234", "iloveyou", "admin", "administrator",
  "adminadmin", "changeme", "monkey", "dragon", "football", "baseball", "master", "sunshine", "princess",
  "login", "starwars", "trustno1", "letmein1", "heimatliebe", "heimatliebe1", "karonga", "malawi",
  "lilongwe", "blantyre", "deutsch", "german", "student", "teacher", "school", "test", "testing", "guest",
  "secret", "shadow", "superman", "batman", "freedom", "whatever", "zaq12wsx", "1qaz2wsx", "asdfghjkl",
  "zxcvbnm", "qazwsx", "google", "facebook", "computer", "internet", "mustang", "harley", "hunter",
]);

/** True when the password is a well-known one, even with a digit/symbol tacked on the end. */
export function isCommonPassword(password: string): boolean {
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return true;
  // "Password123!" is just "password" wearing a hat — strip trailing digits/symbols and test again.
  const stripped = lower.replace(/[^a-z]+$/, "").replace(/^[^a-z]+/, "");
  return stripped.length > 0 && COMMON_PASSWORDS.has(stripped);
}

/**
 * Everything wrong with a candidate password, as plain sentences ready to
 * show to a person. Empty array = acceptable.
 *
 * @param personalData bits of the person's own details (name, email) that
 *   must not appear inside their password.
 */
export function passwordProblems(password: string, personalData: Array<string | undefined> = []): string[] {
  const problems: string[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) problems.push(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) {
    problems.push(`Use no more than ${PASSWORD_MAX_BYTES} characters.`);
  }
  if (!/[a-z]/.test(password)) problems.push("Include a lowercase letter.");
  if (!/[A-Z]/.test(password)) problems.push("Include an uppercase letter.");
  if (!/[0-9]/.test(password)) problems.push("Include a number.");
  if (isCommonPassword(password)) problems.push("That password is too common — choose something less guessable.");

  const lower = password.toLowerCase();
  // Break names/emails into words ("Chikondi Banda" → chikondi, banda) so ANY
  // of them appearing in the password is caught, not just the whole string.
  // Words under 4 letters are skipped: too short to be meaningful and they
  // would reject perfectly good passwords by coincidence.
  const personalWords = personalData
    .flatMap((item) => (item ?? "").split("@")[0].toLowerCase().split(/[^a-z0-9]+/))
    .filter((word) => word.length >= 4);
  if (personalWords.some((word) => lower.includes(word))) {
    problems.push("Don't include your name or email in your password.");
  }

  return problems;
}

/**
 * class-validator decorator: `@IsStrongPassword()` on a DTO property rejects
 * the request with the sentences from passwordProblems(). It also looks at
 * the DTO's own `name` and `email` properties (when present) so a password
 * can't just be the person's own name.
 */
export function IsStrongPassword(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: "isStrongPassword",
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (typeof value !== "string") return false;
          const dto = args.object as { name?: string; email?: string };
          return passwordProblems(value, [dto.name, dto.email]).length === 0;
        },
        defaultMessage(args: ValidationArguments) {
          const dto = args.object as { name?: string; email?: string };
          const value = typeof args.value === "string" ? args.value : "";
          return passwordProblems(value, [dto.name, dto.email]).join(" ") || "Choose a stronger password.";
        },
      },
    });
  };
}
