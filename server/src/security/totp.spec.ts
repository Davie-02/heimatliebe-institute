import { base32Decode, base32Encode, generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, matchTotpStep, otpauthUri, totpAt, verifyTotp } from "./totp";

// RFC 6238 appendix B uses the ASCII secret "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("totp", () => {
  it("matches the RFC 6238 published test vectors (last 6 digits)", () => {
    expect(totpAt(RFC_SECRET, 59_000)).toBe("287082");
    expect(totpAt(RFC_SECRET, 1_111_111_109_000)).toBe("081804");
    expect(totpAt(RFC_SECRET, 1_111_111_111_000)).toBe("050471");
    expect(totpAt(RFC_SECRET, 1_234_567_890_000)).toBe("005924");
    expect(totpAt(RFC_SECRET, 2_000_000_000_000)).toBe("279037");
  });

  it("round-trips base32", () => {
    const bytes = Buffer.from("hello world 123");
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
  });

  it("accepts the current code and one step of clock drift, but nothing further", () => {
    const now = 1_234_567_890_000;
    const code = totpAt(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, code, now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, now + 30_000)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, now + 90_000)).toBe(false);
  });

  it("refuses a code from a step that was already used (no replay)", () => {
    const now = 1_234_567_890_000;
    const code = totpAt(RFC_SECRET, now);
    const step = matchTotpStep(RFC_SECRET, code, now);
    expect(step).toBe(Math.floor(now / 30_000));
    expect(matchTotpStep(RFC_SECRET, code, now, 1, step)).toBeNull();
    // The next code is still fine.
    const next = totpAt(RFC_SECRET, now + 30_000);
    expect(matchTotpStep(RFC_SECRET, next, now + 30_000, 1, step)).toBe(step! + 1);
  });

  it("rejects malformed codes without throwing", () => {
    expect(verifyTotp(RFC_SECRET, "12345", 0)).toBe(false);
    expect(verifyTotp(RFC_SECRET, "abcdef", 0)).toBe(false);
    expect(verifyTotp(RFC_SECRET, "", 0)).toBe(false);
  });

  it("generates 32-character secrets and well-formed otpauth links", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const uri = otpauthUri("admin@example.com", secret);
    expect(uri).toContain("otpauth://totp/Heimatliebe%20Institute%3Aadmin%40example.com");
    expect(uri).toContain(`secret=${secret}`);
  });

  it("recovery codes are unique, and hashing ignores case and whitespace", () => {
    const codes = generateRecoveryCodes(8);
    expect(new Set(codes).size).toBe(8);
    expect(codes[0]).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
    expect(hashRecoveryCode(` ${codes[0].toUpperCase()} `)).toBe(hashRecoveryCode(codes[0]));
  });
});
