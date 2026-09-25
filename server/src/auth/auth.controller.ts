import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { AuthService, type LoginResult } from "./auth.service";
import { ChangePasswordDto, ConfirmIdentityDto, DisableTwoFactorDto, FirstPasswordDto, SignInDto, TwoFactorCodeDto, TwoFactorLoginDto } from "./dto";
import { STAFF_SESSION_COOKIE, STUDENT_SESSION_COOKIE, clearSessionCookie } from "./session-cookie";
import { StaffRoute } from "./roles.decorator";
import { CurrentUser } from "./current-user.decorator";
import { SessionService, type IssuedSession, type SessionClaims } from "./session.service";
import { signInContext } from "./sign-in.controller";

function sessionBody<T extends object>(user: T, session: IssuedSession) {
  return { kind: "staff", user, token: session.token, expiresAt: session.expiresAt };
}

/** Staff account security: the system administrator portal, two-step sign-in, passwords and sessions. */
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService
  ) {}

  private respond(result: LoginResult, response: Response) {
    if (result.kind === "two-factor") return { kind: "two-factor", challenge: result.challenge };
    if (result.kind === "password-change") return { kind: "password-change", challenge: result.challenge, name: result.name };
    clearSessionCookie(response, STUDENT_SESSION_COOKIE);
    this.sessions.attach(response, STAFF_SESSION_COOKIE, result.session);
    return sessionBody(result.user, result.session);
  }

  /** System administrator portal (/admin/login). Other staff use POST /api/sign-in. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("login")
  @HttpCode(200)
  async login(@Body() dto: SignInDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.respond(await this.auth.ownerLogin(dto.email, dto.password, signInContext(request)), response);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("login/2fa")
  @HttpCode(200)
  async loginTwoFactor(@Body() dto: TwoFactorLoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const { session, user } = await this.auth.completeTwoFactorLogin(dto.challenge, dto.code, signInContext(request));
    clearSessionCookie(response, STUDENT_SESSION_COOKIE);
    this.sessions.attach(response, STAFF_SESSION_COOKIE, session);
    return sessionBody(user, session);
  }

  /** First sign-in with an invitation: choose your own password in place of the one-time one. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("first-password")
  @HttpCode(200)
  async firstPassword(@Body() dto: FirstPasswordDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.respond(await this.auth.completeFirstPassword(dto.challenge, dto.newPassword, signInContext(request)), response);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("confirm-identity")
  @HttpCode(200)
  @StaffRoute()
  confirmIdentity(@CurrentUser() user: SessionClaims, @Body() dto: ConfirmIdentityDto) {
    return this.auth.confirmIdentity(user.sub, dto.password, dto.code);
  }

  /** Works for staff and students alike: cancels the token itself, not just the cookie. */
  @Post("logout")
  @HttpCode(200)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.sessions.revokeFromRequest(request, STAFF_SESSION_COOKIE);
    await this.sessions.revokeFromRequest(request, STUDENT_SESSION_COOKIE);
    clearSessionCookie(response, STAFF_SESSION_COOKIE);
    clearSessionCookie(response, STUDENT_SESSION_COOKIE);
    return { loggedOut: true };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("sign-out-everywhere")
  @HttpCode(200)
  @StaffRoute()
  async signOutEverywhere(@CurrentUser() user: SessionClaims, @Res({ passthrough: true }) response: Response) {
    const { session, user: current } = await this.auth.signOutEverywhere(user.sub, user.remember === true);
    this.sessions.attach(response, STAFF_SESSION_COOKIE, session);
    return sessionBody(current, session);
  }

  /** "Am I signed in, and as whom?" Also how the browser checks that its session cookie works. */
  @Get("session")
  @StaffRoute()
  session(@CurrentUser() user: SessionClaims) {
    return this.auth.getSession(user.sub);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("change-password")
  @HttpCode(200)
  @StaffRoute()
  async changePassword(@CurrentUser() user: SessionClaims, @Body() dto: ChangePasswordDto, @Res({ passthrough: true }) response: Response) {
    const { session, user: updated } = await this.auth.changePassword(user.sub, dto.currentPassword, dto.newPassword, user.remember === true);
    this.sessions.attach(response, STAFF_SESSION_COOKIE, session);
    return sessionBody(updated, session);
  }

  @Post("2fa/setup")
  @HttpCode(200)
  @StaffRoute()
  twoFactorSetup(@CurrentUser() user: SessionClaims) {
    return this.auth.beginTwoFactorSetup(user.sub);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("2fa/enable")
  @HttpCode(200)
  @StaffRoute()
  twoFactorEnable(@CurrentUser() user: SessionClaims, @Body() dto: TwoFactorCodeDto) {
    return this.auth.enableTwoFactor(user.sub, dto.code);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("2fa/disable")
  @HttpCode(200)
  @StaffRoute()
  twoFactorDisable(@CurrentUser() user: SessionClaims, @Body() dto: DisableTwoFactorDto) {
    return this.auth.disableTwoFactor(user.sub, dto.password, dto.code);
  }
}
