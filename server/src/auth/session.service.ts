import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Cron, CronExpression } from "@nestjs/schedule";
import { randomUUID } from "crypto";
import type { Request, Response } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { sessionLifetimeMs, setSessionCookie } from "./session-cookie";
import { readCookie } from "./cookies";
import { effectiveAccess, type AccessMap } from "../access/modules";

/** What a guard needs to know about a signed-in staff member beyond the token. */
export interface StaffContext {
  access: AccessMap;
  department: string;
  totpEnabled: boolean;
}

/** Roles a real, signed-in session can carry. Anything else in a token (e.g. a half-finished 2FA sign-in) is refused. */
export const STAFF_ROLES = ["OWNER", "MANAGER", "EMPLOYEE"] as const;
export const SESSION_ROLES = [...STAFF_ROLES, "STUDENT"] as const;
export type SessionRole = (typeof SESSION_ROLES)[number];

/** Marker role of the short-lived token handed out between "password correct" and "2FA code correct". */
const TWO_FACTOR_PENDING_ROLE = "2FA_PENDING";
/** Marker role between "one-time invitation password correct" and "new password chosen". Also never a login. */
const PASSWORD_CHANGE_PENDING_ROLE = "PWCHANGE_PENDING";
const PASSWORD_CHANGE_WINDOW_SECONDS = 15 * 60;
const TWO_FACTOR_WINDOW_SECONDS = 5 * 60;

export interface SessionClaims {
  sub: string;
  role: SessionRole;
  name: string;
  email: string;
  /** Signed in with "keep me signed in" — carried so a re-issued session keeps the same length. */
  remember?: boolean;
  /** Unique id of this one session, so signing out can cancel exactly this token. */
  jti?: string;
  iat?: number;
  exp?: number;
}

export interface IssuedSession {
  token: string;
  maxAgeMs: number;
  expiresAt: string;
  remember: boolean;
}

/** How long a "still active?" answer is trusted, so authenticated requests don't each hit the database. */
const STATUS_CACHE_MS = 15_000;

interface CacheEntry {
  active: boolean;
  role: string | null;
  changedAtMs: number | null;
  revokedAllAtMs: number | null;
  revoked: boolean;
  staff: StaffContext | null;
  until: number;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  /** "role:id:jti" → what the database said last time. */
  private readonly statusCache = new Map<string, CacheEntry>();

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService
  ) {}

  /** Creates the signed token for a sign-in. `remember` picks the long (30-day) or short (default 8-hour) lifetime. */
  async issue(claims: Omit<SessionClaims, "iat" | "remember" | "jti" | "exp">, remember: boolean): Promise<IssuedSession> {
    const maxAgeMs = sessionLifetimeMs(remember);
    const token = await this.jwt.signAsync({ ...claims, remember, jti: randomUUID() }, { expiresIn: Math.floor(maxAgeMs / 1000) });
    return { token, maxAgeMs, expiresAt: new Date(Date.now() + maxAgeMs).toISOString(), remember };
  }

  /** Sets the browser cookie for an issued session. Non-"remember" sessions get a browser-session cookie. */
  attach(response: Response, cookieName: string, session: IssuedSession): void {
    setSessionCookie(response, cookieName, session.token, session.remember ? session.maxAgeMs : undefined);
  }

  /** Token proving "password was right, 2FA code still needed". Cannot be used as a login — see JwtAuthGuard. */
  issueTwoFactorChallenge(staffId: string, remember: boolean): Promise<string> {
    return this.jwt.signAsync({ sub: staffId, role: TWO_FACTOR_PENDING_ROLE, remember }, { expiresIn: TWO_FACTOR_WINDOW_SECONDS });
  }

  async readTwoFactorChallenge(token: string): Promise<{ staffId: string; remember: boolean }> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; role: string; remember?: boolean }>(token);
      if (payload.role !== TWO_FACTOR_PENDING_ROLE) throw new Error("wrong token type");
      return { staffId: payload.sub, remember: Boolean(payload.remember) };
    } catch {
      throw new UnauthorizedException("Your sign-in took too long. Please start again.");
    }
  }

  /** Token proving "the invitation password was right; a new password must now be chosen". */
  issuePasswordChangeChallenge(staffId: string, remember: boolean): Promise<string> {
    return this.jwt.signAsync({ sub: staffId, role: PASSWORD_CHANGE_PENDING_ROLE, remember }, { expiresIn: PASSWORD_CHANGE_WINDOW_SECONDS });
  }

  async readPasswordChangeChallenge(token: string): Promise<{ staffId: string; remember: boolean }> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; role: string; remember?: boolean }>(token);
      if (payload.role !== PASSWORD_CHANGE_PENDING_ROLE) throw new Error("wrong token type");
      return { staffId: payload.sub, remember: Boolean(payload.remember) };
    } catch {
      throw new UnauthorizedException("That took too long. Please sign in again with your one-time password.");
    }
  }

  /**
   * Rejects a token whose account has since been deactivated, whose password was changed after
   * the token was issued, whose role has changed, or that was signed out (this device, or "sign
   * out everywhere"). This makes those take effect immediately instead of when the token expires.
   */
  async assertStillValid(claims: SessionClaims): Promise<StaffContext | null> {
    const key = `${claims.role}:${claims.sub}:${claims.jti ?? ""}`;
    let entry = this.statusCache.get(key);

    if (!entry || entry.until < Date.now()) {
      const revokedLookup = claims.jti
        ? this.prisma.revokedSession.findUnique({ where: { jti: claims.jti }, select: { jti: true } })
        : Promise.resolve(null);
      let row: { isActive: boolean; passwordChangedAt: Date | null; sessionsRevokedAt: Date | null; role: string } | null = null;
      let staff: StaffContext | null = null;
      if (claims.role === "STUDENT") {
        const found = await this.prisma.student.findUnique({
          where: { id: claims.sub },
          select: { isActive: true, status: true, passwordChangedAt: true, sessionsRevokedAt: true },
        });
        // Suspended students can't use the portal; graduates keep read access to their certificates and results.
        row = found ? { ...found, isActive: found.isActive && found.status !== "suspended", role: "STUDENT" } : null;
      } else {
        const found = await this.prisma.staff.findUnique({
          where: { id: claims.sub },
          select: { isActive: true, passwordChangedAt: true, sessionsRevokedAt: true, role: true, department: true, permissions: true, totpEnabled: true },
        });
        row = found;
        if (found) {
          staff = { access: effectiveAccess(found.role, found.department, found.permissions), department: found.department, totpEnabled: found.totpEnabled };
        }
      }
      const revoked = await revokedLookup;

      entry = {
        active: Boolean(row?.isActive),
        role: row?.role ?? null,
        changedAtMs: row?.passwordChangedAt ? row.passwordChangedAt.getTime() : null,
        revokedAllAtMs: row?.sessionsRevokedAt ? row.sessionsRevokedAt.getTime() : null,
        revoked: Boolean(revoked),
        staff,
        until: Date.now() + STATUS_CACHE_MS,
      };
      this.statusCache.set(key, entry);
      // Keep the cache from growing without bound on a long-running server.
      if (this.statusCache.size > 10_000) this.statusCache.clear();
    }

    if (!entry.active) throw new UnauthorizedException("This account is no longer active.");
    if (entry.revoked) throw new UnauthorizedException("You have signed out. Please sign in again.");
    // The role inside the token was true when it was issued; if it has changed, the old access must stop now.
    if (entry.role !== claims.role) throw new UnauthorizedException("Your access level has changed. Please sign in again.");

    // iat is whole seconds; allow a second of slack so a session created in the same instant isn't rejected by rounding.
    const issuedMs = claims.iat !== undefined ? claims.iat * 1000 + 1000 : null;
    if (entry.changedAtMs && issuedMs !== null && issuedMs < entry.changedAtMs) {
      throw new UnauthorizedException("Your password was changed. Please sign in again.");
    }
    if (entry.revokedAllAtMs && issuedMs !== null && issuedMs < entry.revokedAllAtMs) {
      throw new UnauthorizedException("You were signed out on all devices. Please sign in again.");
    }
    return entry.staff;
  }

  /**
   * Signing out: cancels the token the request carries (cookie or header) so a copy of it — left
   * in another tab, or stolen — stops working too. Never fails: signing out must always succeed.
   */
  async revokeFromRequest(request: Request, cookieName: string): Promise<void> {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : readCookie(request.headers.cookie, cookieName);
    if (!token) return;
    try {
      const claims = await this.jwt.verifyAsync<SessionClaims>(token);
      if (!claims.jti || !claims.exp) return;
      await this.prisma.revokedSession.upsert({
        where: { jti: claims.jti },
        create: { jti: claims.jti, expiresAt: new Date(claims.exp * 1000) },
        update: {},
      });
      this.statusCache.delete(`${claims.role}:${claims.sub}:${claims.jti}`);
    } catch {
      // Already expired or invalid — nothing left to cancel.
    }
  }

  /** "Sign out everywhere": every session for this account issued before now stops working. */
  async revokeAll(role: SessionRole, id: string): Promise<void> {
    const now = new Date();
    if (role === "STUDENT") await this.prisma.student.update({ where: { id }, data: { sessionsRevokedAt: now } });
    else await this.prisma.staff.update({ where: { id }, data: { sessionsRevokedAt: now } });
    this.forget(role, id);
  }

  /** Signed-out tokens only need remembering until they would have expired anyway. */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeExpiredRevocations(): Promise<void> {
    try {
      await this.prisma.revokedSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      await this.prisma.authToken.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 7 * 86400_000) } } });
    } catch (error) {
      this.logger.warn(`Could not purge old sign-outs: ${error instanceof Error ? error.message : error}`);
    }
  }

  /** Forget cached answers for one account (call after changing its status, password or access). */
  forget(role: string, id: string): void {
    const prefix = `${role}:${id}:`;
    for (const key of this.statusCache.keys()) if (key.startsWith(prefix)) this.statusCache.delete(key);
  }

  /** Forget every cached answer for a staff member, whatever role their tokens carry (after a role change). */
  forgetStaff(id: string): void {
    for (const role of STAFF_ROLES) this.forget(role, id);
  }
}
