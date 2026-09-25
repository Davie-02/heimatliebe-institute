import { createPublicKey, createVerify, type JsonWebKey } from "crypto";
import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";

/**
 * "Continue with Google / Facebook".
 *
 * The browser talks to the provider and hands us proof of who the person is;
 * this file checks that proof is genuine. We never see the person's provider
 * password — only a signed statement from Google ("this is jane@x.com, and I
 * have verified that address") or a token Facebook confirms when we ask it.
 *
 * Nothing here is enabled until GOOGLE_CLIENT_ID / FACEBOOK_APP_ID(+SECRET)
 * are set (see DEPLOYMENT.md); until then the buttons simply don't appear.
 */

export interface VerifiedIdentity {
  provider: "google" | "facebook";
  /** The provider's stable id for this person — safer to match on than an email, which can change. */
  providerId: string;
  email: string;
  /** True when the provider itself has confirmed the person owns the email. */
  emailVerified: boolean;
  name: string;
}

interface Jwk extends JsonWebKey {
  kid?: string;
}

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

function base64UrlToBuffer(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function parseJwtPart<T>(part: string): T {
  return JSON.parse(base64UrlToBuffer(part).toString("utf8")) as T;
}

/**
 * Verifies a Google ID token ("credential") the way Google documents it:
 *  1. it is signed (RS256) by one of Google's published keys;
 *  2. it was issued by Google, for OUR app (audience = our client id) — this
 *     stops a token minted for some other website being replayed here;
 *  3. it has not expired.
 * Exported separately from the service so it can be tested with a locally
 * generated key instead of the live Google endpoint.
 */
export function verifyGoogleIdTokenWithKeys(
  idToken: string,
  clientId: string,
  keys: Jwk[],
  nowSeconds: number = Math.floor(Date.now() / 1000)
): VerifiedIdentity {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new UnauthorizedException("Invalid Google sign-in.");
  const [headerPart, payloadPart, signaturePart] = parts;

  const header = parseJwtPart<{ alg?: string; kid?: string }>(headerPart);
  if (header.alg !== "RS256") throw new UnauthorizedException("Invalid Google sign-in.");

  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new UnauthorizedException("Invalid Google sign-in.");

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerPart}.${payloadPart}`);
  const signatureOk = verifier.verify(createPublicKey({ key: jwk, format: "jwk" }), base64UrlToBuffer(signaturePart));
  if (!signatureOk) throw new UnauthorizedException("Invalid Google sign-in.");

  const claims = parseJwtPart<{
    iss?: string;
    aud?: string;
    exp?: number;
    sub?: string;
    email?: string;
    email_verified?: boolean | string;
    name?: string;
  }>(payloadPart);

  if (!claims.iss || !GOOGLE_ISSUERS.includes(claims.iss)) throw new UnauthorizedException("Invalid Google sign-in.");
  if (claims.aud !== clientId) throw new UnauthorizedException("This Google sign-in was not issued for this website.");
  if (!claims.exp || claims.exp < nowSeconds) throw new UnauthorizedException("Your Google sign-in expired. Please try again.");
  if (!claims.sub || !claims.email) throw new UnauthorizedException("Google did not share an email address.");

  return {
    provider: "google",
    providerId: claims.sub,
    email: claims.email.toLowerCase(),
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    name: claims.name?.trim() || claims.email.split("@")[0],
  };
}

@Injectable()
export class SocialIdentityService {
  private readonly logger = new Logger(SocialIdentityService.name);
  private googleKeys: { keys: Jwk[]; until: number } | null = null;

  /** Which providers are configured — the browser uses this to decide which buttons to show. */
  providers(): { google: { clientId: string } | null; facebook: { appId: string } | null } {
    return {
      google: process.env.GOOGLE_CLIENT_ID ? { clientId: process.env.GOOGLE_CLIENT_ID } : null,
      facebook: process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET ? { appId: process.env.FACEBOOK_APP_ID } : null,
    };
  }

  /** Google's signing keys, cached for an hour (they rotate rarely). */
  private async loadGoogleKeys(forceRefresh = false): Promise<Jwk[]> {
    if (!forceRefresh && this.googleKeys && this.googleKeys.until > Date.now()) return this.googleKeys.keys;

    const response = await fetch(GOOGLE_JWKS_URL);
    if (!response.ok) throw new UnauthorizedException("Could not reach Google to check your sign-in. Please try again.");
    const body = (await response.json()) as { keys: Jwk[] };
    this.googleKeys = { keys: body.keys, until: Date.now() + 60 * 60 * 1000 };
    return body.keys;
  }

  async verifyGoogle(credential: string): Promise<VerifiedIdentity> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) throw new UnauthorizedException("Google sign-in isn't set up on this site.");

    try {
      return verifyGoogleIdTokenWithKeys(credential, clientId, await this.loadGoogleKeys());
    } catch (error) {
      // An unknown key id usually means Google rotated its keys since we cached them — refetch once and retry.
      if (error instanceof UnauthorizedException) {
        const refreshed = await this.loadGoogleKeys(true);
        return verifyGoogleIdTokenWithKeys(credential, clientId, refreshed);
      }
      throw error;
    }
  }

  /**
   * Facebook gives the browser an access token. We (1) ask Facebook whether
   * that token is valid AND was issued to our app (debug_token, authenticated
   * with our app secret) and (2) read the person's profile with it.
   */
  async verifyFacebook(accessToken: string): Promise<VerifiedIdentity> {
    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    if (!appId || !appSecret) throw new UnauthorizedException("Facebook sign-in isn't set up on this site.");

    const debugUrl = `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`;
    const debug = (await (await fetch(debugUrl)).json().catch(() => null)) as { data?: { is_valid?: boolean; app_id?: string } } | null;
    if (!debug?.data?.is_valid || debug.data.app_id !== appId) {
      throw new UnauthorizedException("Invalid Facebook sign-in.");
    }

    const meUrl = `https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}`;
    const me = (await (await fetch(meUrl)).json().catch(() => null)) as { id?: string; name?: string; email?: string } | null;
    if (!me?.id) throw new UnauthorizedException("Invalid Facebook sign-in.");
    if (!me.email) {
      this.logger.warn("Facebook sign-in without an email address (the person declined to share it).");
      throw new UnauthorizedException("Facebook didn't share your email address, so we can't match it to your account. Please sign in with your email and password instead.");
    }

    return {
      provider: "facebook",
      providerId: me.id,
      email: me.email.toLowerCase(),
      // Facebook only returns an email it has confirmed.
      emailVerified: true,
      name: me.name?.trim() || me.email.split("@")[0],
    };
  }
}
