import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import type { Staff } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "../email/email.service";
import { passwordChangedEmail, passwordResetEmail, signInAlertEmail } from "../email/templates";
import { SessionService, type IssuedSession, type SessionRole } from "./session.service";
import { CLEARED_LOCK_STATE, isLocked, lockedMessage, recordUnknownEmailFailure, stateAfterFailure, unknownEmailLockedUntil } from "../security/lockout";
import { describeDevice } from "../security/device";
import { effectiveAccess, type AccessMap } from "../access/modules";
import { ownerIpAllowed, ownerTwoFactorRequired } from "../access/system-admin-policy";
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, matchTotpStep, otpauthUri } from "../security/totp";

/** Where a sign-in came from — shown in the "new sign-in" alert email. */
export interface SignInContext {
  ip?: string;
  userAgent?: string;
}

/** What the browser is told about a signed-in staff member. */
export interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  jobTitle: string | null;
  photoUrl: string | null;
  twoFactorEnabled: boolean;
  /** Module → level this person can use (what the workspace shows them). */
  access: AccessMap;
  /** A system administrator who still has to set up two-step verification before anything else works. */
  mustSetUpTwoFactor: boolean;
}

/** Result of step one of sign-in: you're in, a 2FA code is still needed, or a first password must be chosen. */
export type LoginResult =
  | { kind: "session"; session: IssuedSession; user: StaffUser }
  | { kind: "two-factor"; challenge: string }
  | { kind: "password-change"; challenge: string; name: string };

export interface StaffPasswordCheck {
  staff: Staff | null;
  matches: boolean;
  locked: boolean;
}

/** How long a "confirm it's you" lasts for sensitive actions (changing access, adding administrators…). */
const STEP_UP_MS = 10 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/**
 * A real bcrypt hash of a throwaway string. Signing in with an email we don't have still compares
 * against it, so the answer takes as long as a real wrong password — timing reveals nothing.
 */
export const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export const frontendUrl = () => (process.env.FRONTEND_URL ?? "http://localhost:5173").replace(/\/+$/, "");

/**
 * Staff sign-in and account security: password, two-step verification (authenticator app plus
 * recovery codes), invitations with a one-time password, lockout after repeated failures,
 * "confirm it's you" for sensitive actions, password reset and "sign out everywhere".
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly sessions: SessionService
  ) {}

  toUser(staff: Staff): StaffUser {
    return {
      id: staff.id,
      name: staff.name,
      email: staff.email,
      role: staff.role,
      department: staff.department,
      jobTitle: staff.jobTitle,
      photoUrl: staff.photoUrl,
      twoFactorEnabled: staff.totpEnabled,
      access: effectiveAccess(staff.role, staff.department, staff.permissions),
      mustSetUpTwoFactor: staff.role === "OWNER" && ownerTwoFactorRequired() && !staff.totpEnabled,
    };
  }

  private issueFor(staff: Staff, remember: boolean) {
    return this.sessions.issue({ sub: staff.id, role: staff.role as SessionRole, name: staff.name, email: staff.email }, remember);
  }

  /** Counts one more wrong attempt (and locks the account when the limit is reached). */
  async recordFailure(staff: { id: string; failedLoginCount: number }): Promise<void> {
    await this.prisma.staff.update({ where: { id: staff.id }, data: stateAfterFailure(staff.failedLoginCount) });
  }

  /**
   * Checks a password against the staff account with this email (if any) without deciding
   * anything. Always does one bcrypt compare — against a dummy hash when there's no account.
   */
  async checkPassword(email: string, password: string): Promise<StaffPasswordCheck> {
    const staff = await this.prisma.staff.findFirst({ where: { email: { equals: email.trim().toLowerCase(), mode: "insensitive" } } });
    const locked = Boolean(staff?.lockedUntil && isLocked(staff.lockedUntil));
    const matches = await bcrypt.compare(password, staff?.passwordHash ?? DUMMY_HASH);
    return { staff, matches: Boolean(staff && staff.isActive && matches && !locked), locked };
  }

  /**
   * The SYSTEM ADMINISTRATOR PORTAL (/admin/login): owner accounts only. Everyone else uses the
   * website's sign-in page. Every failure gives the identical "Invalid email or password" (except
   * the lockout notice), so this page never confirms who has what kind of account.
   */
  async ownerLogin(email: string, password: string, context: SignInContext = {}): Promise<LoginResult> {
    const phantomLock = unknownEmailLockedUntil(email);
    if (phantomLock) throw new UnauthorizedException(lockedMessage(phantomLock));
    const { staff, matches, locked } = await this.checkPassword(email, password);
    if (staff && locked) throw new UnauthorizedException(lockedMessage(staff.lockedUntil!));
    if (!staff || !matches) {
      if (staff) await this.recordFailure(staff);
      else {
        const lock = recordUnknownEmailFailure(email);
        if (lock) throw new UnauthorizedException(lockedMessage(lock));
      }
      throw new UnauthorizedException("Invalid email or password.");
    }
    if (staff.role !== "OWNER" || !ownerIpAllowed(context.ip)) throw new UnauthorizedException("Invalid email or password.");
    return this.continueSignIn(staff, false, context);
  }

  /**
   * After a correct password: an invitation's one-time password must be replaced first; then
   * two-step verification if it's on; otherwise the session. Owners never get "keep me signed in".
   */
  async continueSignIn(staff: Staff, remember: boolean, context: SignInContext): Promise<LoginResult> {
    const keep = staff.role === "OWNER" ? false : remember;
    if (staff.mustChangePassword) {
      if (staff.tempPasswordExpiresAt && staff.tempPasswordExpiresAt < new Date()) {
        throw new UnauthorizedException("Your one-time password has expired. Ask HR or the system administrator to send a new invitation.");
      }
      return { kind: "password-change", challenge: await this.sessions.issuePasswordChangeChallenge(staff.id, keep), name: staff.name };
    }
    if (staff.totpEnabled) return { kind: "two-factor", challenge: await this.sessions.issueTwoFactorChallenge(staff.id, keep) };
    return { kind: "session", session: await this.completeSignIn(staff, keep, context), user: this.toUser(staff) };
  }

  /** First sign-in with an invitation: replaces the one-time password with the person's own, then continues. */
  async completeFirstPassword(challenge: string, newPassword: string, context: SignInContext = {}): Promise<LoginResult> {
    const { staffId, remember } = await this.sessions.readPasswordChangeChallenge(challenge);
    const staff = await this.prisma.staff.findUnique({ where: { id: staffId } });
    if (!staff || !staff.isActive || !staff.mustChangePassword) throw new UnauthorizedException("Please sign in again.");
    if (await bcrypt.compare(newPassword, staff.passwordHash)) {
      throw new BadRequestException("Choose a new password — not the one-time password from the email.");
    }
    const updated = await this.prisma.staff.update({
      where: { id: staffId },
      data: { passwordHash: await bcrypt.hash(newPassword, 12), mustChangePassword: false, tempPasswordExpiresAt: null, passwordChangedAt: new Date(), ...CLEARED_LOCK_STATE },
    });
    this.sessions.forgetStaff(staffId);
    return this.continueSignIn(updated, remember, context);
  }

  /** "Confirm it's you" (password, plus the authenticator code when two-step is on) before sensitive actions. */
  async confirmIdentity(staffId: string, password: string, code?: string): Promise<{ confirmedUntil: string }> {
    const staff = await this.prisma.staff.findUniqueOrThrow({ where: { id: staffId } });
    if (staff.lockedUntil && isLocked(staff.lockedUntil)) throw new UnauthorizedException(lockedMessage(staff.lockedUntil));
    if (!(await bcrypt.compare(password, staff.passwordHash))) {
      await this.recordFailure(staff);
      throw new UnauthorizedException("Your password isn't right.");
    }
    if (staff.totpEnabled && !(code && (await this.checkSecondFactor(staff, code)))) {
      throw new UnauthorizedException("Enter the current code from your authenticator app.");
    }
    const until = new Date(Date.now() + STEP_UP_MS);
    await this.prisma.staff.update({ where: { id: staffId }, data: { stepUpUntil: until } });
    return { confirmedUntil: until.toISOString() };
  }

  /** Forgive past failures, note the time, send the sign-in alert, mint the session. */
  async completeSignIn(staff: Staff, remember: boolean, context: SignInContext): Promise<IssuedSession> {
    const now = new Date();
    await this.prisma.staff.update({ where: { id: staff.id }, data: { ...CLEARED_LOCK_STATE, lastLoginAt: now } });
    // Not awaited: the alert must never slow down or block signing in.
    if ((process.env.SIGN_IN_ALERTS ?? "true") !== "false") {
      void this.email
        .send({
          to: staff.email,
          ...signInAlertEmail({ name: staff.name, when: now, ip: context.ip ?? "unknown", device: describeDevice(context.userAgent), securityUrl: `${frontendUrl()}/admin/security` }),
        })
        .catch(() => undefined);
    }
    return this.issueFor(staff, remember);
  }

  /** Step two: the 6-digit code (or a recovery code). Wrong codes count toward the same lockout as passwords. */
  async completeTwoFactorLogin(challenge: string, code: string, context: SignInContext = {}): Promise<{ session: IssuedSession; user: StaffUser }> {
    const { staffId, remember } = await this.sessions.readTwoFactorChallenge(challenge);
    const staff = await this.prisma.staff.findUnique({ where: { id: staffId } });
    if (!staff || !staff.isActive || !staff.totpEnabled || !staff.totpSecret) throw new UnauthorizedException("Invalid sign-in.");
    if (staff.lockedUntil && isLocked(staff.lockedUntil)) throw new UnauthorizedException(lockedMessage(staff.lockedUntil));
    if (!(await this.checkSecondFactor(staff, code))) {
      await this.recordFailure(staff);
      throw new UnauthorizedException("That code isn't right. Check your authenticator app and try again.");
    }
    return { session: await this.completeSignIn(staff, staff.role === "OWNER" ? false : remember, context), user: this.toUser(staff) };
  }

  /**
   * Accepts the current authenticator code or an unused recovery code. Each code works ONCE: the
   * accepted 30-second step is stored and that step (and older) are refused afterwards, so a code
   * seen over someone's shoulder can't be replayed. Both are claimed with a conditional update, so
   * two simultaneous attempts can't both use the same code.
   */
  private async checkSecondFactor(staff: { id: string; totpSecret: string | null; recoveryCodeHashes: string[]; lastTotpStep: number | null }, code: string): Promise<boolean> {
    const step = staff.totpSecret ? matchTotpStep(staff.totpSecret, code, Date.now(), 1, staff.lastTotpStep) : null;
    if (step !== null) {
      const claimed = await this.prisma.staff.updateMany({
        where: { id: staff.id, OR: [{ lastTotpStep: null }, { lastTotpStep: { lt: step } }] },
        data: { lastTotpStep: step },
      });
      return claimed.count === 1;
    }
    const hash = hashRecoveryCode(code);
    if (!staff.recoveryCodeHashes.includes(hash)) return false;
    const claimed = await this.prisma.staff.updateMany({
      where: { id: staff.id, recoveryCodeHashes: { has: hash } },
      data: { recoveryCodeHashes: staff.recoveryCodeHashes.filter((existing) => existing !== hash) },
    });
    return claimed.count === 1;
  }

  async getSession(staffId: string): Promise<{ user: StaffUser }> {
    const staff = await this.prisma.staff.findUnique({ where: { id: staffId } });
    if (!staff || !staff.isActive) throw new UnauthorizedException("This account is no longer active.");
    return { user: this.toUser(staff) };
  }

  // ── Two-step verification setup ─────────────────────────────────────────────

  async beginTwoFactorSetup(staffId: string): Promise<{ secret: string; otpauthUri: string }> {
    const staff = await this.prisma.staff.findUniqueOrThrow({ where: { id: staffId } });
    if (staff.totpEnabled) throw new BadRequestException("Two-step verification is already on. Turn it off first to set it up again.");
    const secret = generateTotpSecret();
    await this.prisma.staff.update({ where: { id: staffId }, data: { totpSecret: secret } });
    return { secret, otpauthUri: otpauthUri(staff.email, secret) };
  }

  /** Confirms setup with a first code, switches it on and returns the one-time recovery codes (shown only now). */
  async enableTwoFactor(staffId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const staff = await this.prisma.staff.findUniqueOrThrow({ where: { id: staffId } });
    if (!staff.totpSecret || staff.totpEnabled) throw new BadRequestException("Start two-step setup first.");
    const step = matchTotpStep(staff.totpSecret, code);
    if (step === null) throw new BadRequestException("That code isn't right. Check your authenticator app and try again.");
    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.staff.update({
      where: { id: staffId },
      data: { totpEnabled: true, recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode), lastTotpStep: step },
    });
    this.sessions.forgetStaff(staffId);
    return { recoveryCodes };
  }

  async disableTwoFactor(staffId: string, password: string, code: string): Promise<{ disabled: true }> {
    const staff = await this.prisma.staff.findUniqueOrThrow({ where: { id: staffId } });
    if (staff.role === "OWNER" && ownerTwoFactorRequired()) throw new BadRequestException("System administrators must keep two-step verification on.");
    if (!(await bcrypt.compare(password, staff.passwordHash))) throw new UnauthorizedException("Your password isn't right.");
    if (!(await this.checkSecondFactor(staff, code))) throw new UnauthorizedException("That code isn't right.");
    await this.prisma.staff.update({ where: { id: staffId }, data: { totpEnabled: false, totpSecret: null, recoveryCodeHashes: [], lastTotpStep: null } });
    this.sessions.forgetStaff(staffId);
    return { disabled: true };
  }

  /** Signs out every other device (lost phone, unrecognised sign-in). Returns a fresh session for this one. */
  async signOutEverywhere(staffId: string, remember: boolean): Promise<{ session: IssuedSession; user: StaffUser }> {
    const staff = await this.prisma.staff.findUniqueOrThrow({ where: { id: staffId } });
    await this.sessions.revokeAll(staff.role as SessionRole, staffId);
    return { session: await this.issueFor(staff, remember), user: this.toUser(staff) };
  }

  // ── Passwords ───────────────────────────────────────────────────────────────

  async changePassword(staffId: string, currentPassword: string, newPassword: string, remember: boolean): Promise<{ session: IssuedSession; user: StaffUser }> {
    const staff = await this.prisma.staff.findUniqueOrThrow({ where: { id: staffId } });
    if (!(await bcrypt.compare(currentPassword, staff.passwordHash))) throw new UnauthorizedException("Your current password isn't right.");
    if (currentPassword === newPassword) throw new BadRequestException("Choose a password you haven't been using.");
    await this.prisma.staff.update({ where: { id: staffId }, data: { passwordHash: await bcrypt.hash(newPassword, 12), passwordChangedAt: new Date() } });
    this.sessions.forgetStaff(staffId);
    void this.email.send({ to: staff.email, ...passwordChangedEmail(staff.name) }).catch(() => undefined);
    return { session: await this.issueFor(staff, remember), user: this.toUser(staff) };
  }

  /** Always answers the same way whether or not the email has an account, so it can't be used to find out who works here. */
  async requestPasswordReset(email: string): Promise<{ requested: true }> {
    const staff = await this.prisma.staff.findFirst({ where: { email: { equals: email.trim().toLowerCase(), mode: "insensitive" } } });
    if (staff && staff.isActive) {
      const rawToken = randomBytes(32).toString("hex");
      await this.prisma.authToken.create({
        data: { realm: "staff", accountId: staff.id, purpose: "reset", tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS) },
      });
      // Not awaited, so "account exists" isn't measurably slower than "no such account".
      void this.email.send({ to: staff.email, ...passwordResetEmail(`${frontendUrl()}/reset-password?token=${rawToken}`) }).catch(() => undefined);
    }
    return { requested: true };
  }

  /** Completes a reset from the emailed link (claimed atomically, so a link works once). Also signs the account out everywhere. */
  async resetPassword(rawToken: string, newPassword: string): Promise<boolean> {
    const token = await this.prisma.authToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
    if (!token || token.realm !== "staff" || token.usedAt || token.expiresAt < new Date()) return false;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.authToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
      if (claimed.count !== 1) throw new BadRequestException("This link is invalid or has expired.");
      await tx.staff.update({
        where: { id: token.accountId },
        data: { passwordHash: await bcrypt.hash(newPassword, 12), passwordChangedAt: now, mustChangePassword: false, tempPasswordExpiresAt: null, ...CLEARED_LOCK_STATE },
      });
      await tx.authToken.updateMany({ where: { realm: "staff", accountId: token.accountId, usedAt: null }, data: { usedAt: now } });
    });
    this.sessions.forgetStaff(token.accountId);
    return true;
  }
}
