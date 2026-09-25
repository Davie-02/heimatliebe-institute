import type { Request } from "express";
import { createCsrfToken, csrfCheckRequired, hasValidCsrfToken, isValidSignedCsrfToken } from "./csrf";

process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-signing-tokens";

const req = (path: string, cookie?: string, token?: string) =>
  ({ path, headers: { ...(cookie ? { cookie } : {}), ...(token ? { "x-csrf-token": token } : {}) } }) as unknown as Request;

describe("csrfCheckRequired", () => {
  it("skips anonymous public requests", () => {
    expect(csrfCheckRequired(req("/api/public/enquiries"))).toBe(false);
    expect(csrfCheckRequired(req("/api/assistant/chat", "hml_csrf=abc"))).toBe(false);
  });

  it("requires a token whenever a session cookie is present", () => {
    expect(csrfCheckRequired(req("/api/r/courses", "hml_staff_session=jwt"))).toBe(true);
    expect(csrfCheckRequired(req("/api/me/payments", "a=b; hml_student_session=jwt"))).toBe(true);
  });

  it("always protects sign-in and password forms", () => {
    for (const path of ["/api/sign-in", "/api/auth/login", "/api/auth/login/2fa", "/api/sign-in/set-password", "/api/sign-in/reset-password", "/api/sign-in/social", "/api/auth/first-password"]) {
      expect(csrfCheckRequired(req(path))).toBe(true);
    }
  });
});

describe("signed tokens", () => {
  it("accepts a fresh token and rejects tampering or expiry", () => {
    const token = createCsrfToken();
    expect(isValidSignedCsrfToken(token)).toBe(true);
    expect(isValidSignedCsrfToken(token.slice(0, -1) + (token.endsWith("a") ? "b" : "a"))).toBe(false);
    expect(isValidSignedCsrfToken(createCsrfToken(Date.now() - 3 * 3600 * 1000))).toBe(false);
    expect(isValidSignedCsrfToken("not-a-token")).toBe(false);
  });

  it("reads the token from the header", () => {
    expect(hasValidCsrfToken(req("/x", undefined, createCsrfToken()))).toBe(true);
    expect(hasValidCsrfToken(req("/x"))).toBe(false);
  });
});
