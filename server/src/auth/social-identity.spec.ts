import { generateKeyPairSync, createSign, type JsonWebKey } from "crypto";
import { UnauthorizedException } from "@nestjs/common";
import { verifyGoogleIdTokenWithKeys } from "./social-identity";

const CLIENT_ID = "test-client.apps.googleusercontent.com";
const NOW = 1_800_000_000;

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: "jwk" }) as JsonWebKey), kid: "key-1" };

const b64 = (value: object | Buffer) =>
  Buffer.from(value instanceof Buffer ? value : JSON.stringify(value)).toString("base64url");

/** Signs a token exactly the way Google does, with our locally generated key. */
function makeToken(claims: object, header: object = { alg: "RS256", kid: "key-1" }, key = privateKey): string {
  const signingInput = `${b64(header)}.${b64(claims)}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(key);
  return `${signingInput}.${b64(signature)}`;
}

const goodClaims = {
  iss: "https://accounts.google.com",
  aud: CLIENT_ID,
  exp: NOW + 3600,
  sub: "google-user-1",
  email: "Jane@Example.com",
  email_verified: true,
  name: "Jane Banda",
};

describe("verifyGoogleIdTokenWithKeys", () => {
  it("accepts a genuine token and normalises the result", () => {
    const identity = verifyGoogleIdTokenWithKeys(makeToken(goodClaims), CLIENT_ID, [jwk], NOW);
    expect(identity).toEqual({
      provider: "google",
      providerId: "google-user-1",
      email: "jane@example.com",
      emailVerified: true,
      name: "Jane Banda",
    });
  });

  it("rejects a token signed with a different key", () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() => verifyGoogleIdTokenWithKeys(makeToken(goodClaims, undefined, other.privateKey), CLIENT_ID, [jwk], NOW)).toThrow(UnauthorizedException);
  });

  it("rejects a token issued for a different app (audience mismatch)", () => {
    expect(() => verifyGoogleIdTokenWithKeys(makeToken({ ...goodClaims, aud: "someone-else" }), CLIENT_ID, [jwk], NOW)).toThrow(/not issued for this website/);
  });

  it("rejects an expired token", () => {
    expect(() => verifyGoogleIdTokenWithKeys(makeToken({ ...goodClaims, exp: NOW - 10 }), CLIENT_ID, [jwk], NOW)).toThrow(/expired/);
  });

  it("rejects a token from the wrong issuer", () => {
    expect(() => verifyGoogleIdTokenWithKeys(makeToken({ ...goodClaims, iss: "https://evil.example" }), CLIENT_ID, [jwk], NOW)).toThrow(UnauthorizedException);
  });

  it("rejects tokens using an algorithm other than RS256 (the classic alg=none trick)", () => {
    const forged = `${b64({ alg: "none", kid: "key-1" })}.${b64(goodClaims)}.`;
    expect(() => verifyGoogleIdTokenWithKeys(forged, CLIENT_ID, [jwk], NOW)).toThrow(UnauthorizedException);
  });

  it("rejects a token whose key id is unknown", () => {
    expect(() => verifyGoogleIdTokenWithKeys(makeToken(goodClaims, { alg: "RS256", kid: "nope" }), CLIENT_ID, [jwk], NOW)).toThrow(UnauthorizedException);
  });

  it("rejects a payload that was tampered with after signing", () => {
    const [h, , s] = makeToken(goodClaims).split(".");
    const tampered = `${h}.${b64({ ...goodClaims, email: "admin@victim.com" })}.${s}`;
    expect(() => verifyGoogleIdTokenWithKeys(tampered, CLIENT_ID, [jwk], NOW)).toThrow(UnauthorizedException);
  });
});
