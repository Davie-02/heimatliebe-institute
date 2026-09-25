/**
 * The website's one sign-in form, for students AND staff (POST /api/sign-in), plus the password
 * reset, invitation and Google/Facebook flows that serve both.
 *
 * The same email may belong to a student account, a staff account, or both (a teacher who is
 * also taking a course). The password is checked against each — always the same amount of work,
 * so timing reveals nothing — and the account it opens decides where the person goes: staff to
 * the workspace (/admin), students to their portal (/portal). If both match, staff wins.
 *
 * System administrator (OWNER) accounts are refused here with the ordinary "Invalid email or
 * password": they sign in only through their own portal, and nothing on this page hints at it.
 */
import { BadRequestException, Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { AuthService, type LoginResult } from "./auth.service";
import { StudentAuthService } from "./student-auth.service";
import { SessionService, type IssuedSession } from "./session.service";
import { SocialIdentityService } from "./social-identity";
import { STAFF_SESSION_COOKIE, STUDENT_SESSION_COOKIE, clearSessionCookie } from "./session-cookie";
import { lockedMessage, recordUnknownEmailFailure, unknownEmailLockedUntil } from "../security/lockout";
import { createCsrfToken } from "./csrf";
import { ForgotPasswordDto, ResetPasswordDto, SignInDto, SocialSignInDto } from "./dto";
import { PrismaService } from "../prisma/prisma.service";

export function signInContext(request: Request) {
  return { ip: request.ip, userAgent: request.headers["user-agent"]?.slice(0, 300) };
}

@Controller()
export class SignInController {
  constructor(
    private readonly staffAuth: AuthService,
    private readonly studentAuth: StudentAuthService,
    private readonly sessions: SessionService,
    private readonly social: SocialIdentityService,
    private readonly prisma: PrismaService
  ) {}

  /** A fresh anti-forgery token. Signed, so the server needs no cookie to check it later (see csrf.ts). */
  @Get("auth/csrf")
  csrf() {
    return { token: createCsrfToken() };
  }

  /** Which "Continue with…" buttons to show. */
  @Get("auth/providers")
  providers() {
    return this.social.providers();
  }

  private staffResponse(result: LoginResult, response: Response) {
    if (result.kind === "two-factor") return { kind: "two-factor", challenge: result.challenge };
    if (result.kind === "password-change") return { kind: "password-change", challenge: result.challenge, name: result.name };
    // One person, one kind of session in this browser at a time.
    clearSessionCookie(response, STUDENT_SESSION_COOKIE);
    this.sessions.attach(response, STAFF_SESSION_COOKIE, result.session);
    return { kind: "staff", user: result.user, token: result.session.token, expiresAt: result.session.expiresAt };
  }

  private studentResponse(result: { session: IssuedSession; user: unknown }, response: Response) {
    clearSessionCookie(response, STAFF_SESSION_COOKIE);
    this.sessions.attach(response, STUDENT_SESSION_COOKIE, result.session);
    return { kind: "student", user: result.user, token: result.session.token, expiresAt: result.session.expiresAt };
  }

  // 5 attempts a minute per network address; per-account lockout covers attacks spread over many addresses.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("sign-in")
  @HttpCode(200)
  async signIn(@Body() dto: SignInDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const remember = dto.remember === true;
    const phantomLock = unknownEmailLockedUntil(dto.email);
    if (phantomLock) throw new UnauthorizedException(lockedMessage(phantomLock));
    const [staff, student] = await Promise.all([this.staffAuth.checkPassword(dto.email, dto.password), this.studentAuth.checkPassword(dto.email, dto.password)]);

    if (staff.matches && staff.staff) {
      if (staff.staff.role === "OWNER") throw new UnauthorizedException("Invalid email or password.");
      return this.staffResponse(await this.staffAuth.continueSignIn(staff.staff, remember, signInContext(request)), response);
    }
    if (student.matches && student.student) {
      return this.studentResponse(await this.studentAuth.completeSignIn(student.student, remember), response);
    }

    // Nothing opened. Count the wrong password against whichever accounts exist.
    const existing = [staff.staff, student.student].filter(Boolean);
    if (existing.length === 0) {
      const lock = recordUnknownEmailFailure(dto.email);
      if (lock) throw new UnauthorizedException(lockedMessage(lock));
    }
    if (staff.staff && !staff.locked) await this.staffAuth.recordFailure(staff.staff);
    if (student.student && !student.locked) await this.studentAuth.recordFailure(student.student);
    const allLocked = existing.length > 0 && (!staff.staff || staff.locked) && (!student.student || student.locked);
    const until = staff.staff?.lockedUntil ?? student.student?.lockedUntil;
    if (allLocked && until) throw new UnauthorizedException(lockedMessage(until));
    if (student.student && !student.student.passwordHash) {
      throw new UnauthorizedException("You haven't chosen a password yet. Use the link in your welcome email, or choose “Forgot password”.");
    }
    throw new UnauthorizedException("Invalid email or password.");
  }

  /**
   * "Continue with Google / Facebook": the provider proves the email address; we sign in the
   * existing account with that address (staff first, then student). No accounts are created here.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("sign-in/social")
  @HttpCode(200)
  async socialSignIn(@Body() dto: SocialSignInDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const identity = dto.provider === "google" ? await this.social.verifyGoogle(dto.token) : await this.social.verifyFacebook(dto.token);
    if (!identity.emailVerified) throw new UnauthorizedException("Your email address isn't verified with that provider.");
    const idField = identity.provider === "google" ? "googleId" : "facebookId";
    const remember = dto.remember === true;

    const staff = await this.prisma.staff.findFirst({
      where: { OR: [{ [idField]: identity.providerId }, { email: { equals: identity.email, mode: "insensitive" } }] },
    });
    if (staff && staff.isActive && staff.role !== "OWNER") {
      if (!staff[idField]) await this.prisma.staff.update({ where: { id: staff.id }, data: { [idField]: identity.providerId } });
      // The provider replaces the password, not the second step: two-step verification still applies.
      if (staff.totpEnabled) return { kind: "two-factor", challenge: await this.sessions.issueTwoFactorChallenge(staff.id, remember) };
      return this.staffResponse({ kind: "session", session: await this.staffAuth.completeSignIn(staff, remember, signInContext(request)), user: this.staffAuth.toUser(staff) }, response);
    }

    const student = await this.prisma.student.findFirst({
      where: { OR: [{ [idField]: identity.providerId }, { email: { equals: identity.email, mode: "insensitive" } }] },
    });
    if (student && student.isActive && student.status !== "suspended") {
      if (!student[idField]) await this.prisma.student.update({ where: { id: student.id }, data: { [idField]: identity.providerId } });
      return this.studentResponse(await this.studentAuth.completeSignIn(student, remember), response);
    }
    throw new UnauthorizedException("There's no account for that email address. To study with us, apply online first.");
  }

  /** Sends a reset link to every account (staff and/or student) with this email. Same answer either way. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("sign-in/forgot-password")
  @HttpCode(200)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await Promise.all([this.staffAuth.requestPasswordReset(dto.email), this.studentAuth.requestPasswordReset(dto.email)]);
    return { requested: true };
  }

  /** Completes a reset or a student invitation from an emailed link. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("sign-in/reset-password")
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    if (await this.staffAuth.resetPassword(dto.token, dto.newPassword)) return { reset: true, realm: "staff" };
    if (await this.studentAuth.setPasswordFromToken(dto.token, dto.newPassword)) return { reset: true, realm: "student" };
    throw new BadRequestException("This link is invalid or has expired.");
  }

  /** Invitation links use the same code path as resets. Kept as its own address so the email reads naturally. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("sign-in/set-password")
  @HttpCode(200)
  async setPassword(@Body() dto: ResetPasswordDto) {
    return this.resetPassword(dto);
  }
}
