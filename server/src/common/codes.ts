import { randomInt } from "crypto";

/**
 * Human-facing reference numbers. Random parts come from the cryptographic generator and skip
 * look-alike characters (0/O, 1/I/L), so they can be read out over the phone without mistakes and
 * can't be guessed from one another (an application reference is also its tracking key).
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function randomCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

const year = () => new Date().getFullYear();

export const applicationReference = () => `APP-${randomCode(8)}`;
export const invoiceNumber = () => `INV-${year()}-${randomCode(6)}`;
export const receiptNumber = () => `RCT-${year()}-${randomCode(6)}`;
export const certificateNumber = () => `HMLI-C-${year()}-${randomCode(5)}`;
export const verificationCode = () => randomCode(10);
export const staffNumber = () => `ST-${randomCode(5)}`;

/** Student numbers read HMLI-2026-0042: the year, then the next number in that year. */
export function studentNumber(yearValue: number, sequence: number): string {
  return `HMLI-${yearValue}-${String(sequence).padStart(4, "0")}`;
}

/** URL-friendly version of a title: "German A1 – Evening" → "german-a1-evening". */
export function slugify(text: string): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || randomCode(6).toLowerCase()
  );
}
