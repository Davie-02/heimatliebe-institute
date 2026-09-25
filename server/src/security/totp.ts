import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Time-based one-time passwords (RFC 6238) — the 6-digit codes produced by
 * Google Authenticator, Microsoft Authenticator, Authy, 1Password, etc.
 * Implemented directly on Node's crypto so there is nothing extra to install
 * or keep patched. Used for optional admin two-factor sign-in.
 *
 * How it works: the server and the admin's phone share a secret. Every 30
 * seconds both compute HMAC-SHA1(secret, floor(time / 30)) and turn it into 6
 * digits, so a code is only valid for a moment and can't be reused later.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32 (no padding) — the encoding authenticator apps expect for the secret. */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Invalid base32 character");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh random secret (160 bits, the size RFC 4226 recommends), base32-encoded. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The code for a given moment. Exposed mainly so tests can check the RFC's published vectors. */
export function totpAt(secret: string, timeMs: number): string {
  const counter = Math.floor(timeMs / 1000 / STEP_SECONDS);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", base32Decode(secret)).update(message).digest();
  // "Dynamic truncation": the last nibble picks which 4 bytes of the hash to use.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * Is `code` the right code right now? Accepts the previous and next 30-second
 * windows too (`window` = 1) because phone and server clocks are never
 * perfectly in step.
 */
export function verifyTotp(secret: string, code: string, nowMs: number = Date.now(), window = 1): boolean {
  return matchTotpStep(secret, code, nowMs, window) !== null;
}

/**
 * Like verifyTotp, but returns WHICH 30-second step the code belongs to (or
 * null). Sign-in stores the step and refuses any code from that step or an
 * earlier one, so a code that has been used — or watched being typed — can't
 * be replayed within its validity window.
 */
export function matchTotpStep(secret: string, code: string, nowMs: number = Date.now(), window = 1, notAfterStep?: number | null): number | null {
  const cleaned = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return null;

  const currentStep = Math.floor(nowMs / 1000 / STEP_SECONDS);
  for (let drift = -window; drift <= window; drift++) {
    const step = currentStep + drift;
    if (notAfterStep !== undefined && notAfterStep !== null && step <= notAfterStep) continue;
    const expected = totpAt(secret, step * STEP_SECONDS * 1000);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(cleaned))) return step;
  }
  return null;
}

/** The `otpauth://` address that authenticator apps read from a QR code (or accept as a link). */
export function otpauthUri(accountEmail: string, secret: string, issuer = "Heimatliebe Institute"): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/**
 * One-time backup codes for an admin who loses their phone. Shown once at
 * setup; only their hashes are stored, and each works a single time.
 */
export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString("hex"); // 10 hex chars
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.trim().toLowerCase()).digest("hex");
}
