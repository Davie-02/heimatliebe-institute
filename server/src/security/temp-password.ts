import { randomInt } from "crypto";
import { passwordProblems } from "./password-policy";

/**
 * One-time passwords for staff invitations: 20 characters from the
 * cryptographic generator, always mixing lower case, upper case, digits and
 * symbols (about 125 bits of randomness). Look-alike characters (0/O, 1/l/I)
 * are left out so it can be typed from an email without mistakes. It only
 * works until the person's first sign-in, where they must choose their own.
 */
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*-_=+?";
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

export const TEMP_PASSWORD_LENGTH = 20;
/** How long an invitation password works before it must be re-sent. */
export const TEMP_PASSWORD_TTL_MS = 72 * 60 * 60 * 1000;

const pick = (chars: string) => chars[randomInt(chars.length)];

export function generateTempPassword(): string {
  for (;;) {
    const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
    while (chars.length < TEMP_PASSWORD_LENGTH) chars.push(pick(ALL));
    // Shuffle (Fisher–Yates) so the guaranteed characters aren't always first.
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    const password = chars.join("");
    if (passwordProblems(password).length === 0) return password;
  }
}
