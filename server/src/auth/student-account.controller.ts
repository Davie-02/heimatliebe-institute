import { Body, Controller, Get, HttpCode, Post, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { StudentAuthService } from "./student-auth.service";
import { ChangePasswordDto } from "./dto";
import { StudentRoute } from "./roles.decorator";
import { CurrentUser } from "./current-user.decorator";
import { SessionService, type SessionClaims } from "./session.service";
import { STUDENT_SESSION_COOKIE } from "./session-cookie";

/** A signed-in student's own session and password. */
@Controller("student-auth")
@StudentRoute()
export class StudentAccountController {
  constructor(
    private readonly students: StudentAuthService,
    private readonly sessions: SessionService
  ) {}

  @Get("session")
  session(@CurrentUser() user: SessionClaims) {
    return this.students.getSession(user.sub);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("change-password")
  @HttpCode(200)
  async changePassword(@CurrentUser() user: SessionClaims, @Body() dto: ChangePasswordDto, @Res({ passthrough: true }) response: Response) {
    const { session, user: updated } = await this.students.changePassword(user.sub, dto.currentPassword, dto.newPassword, user.remember === true);
    this.sessions.attach(response, STUDENT_SESSION_COOKIE, session);
    return { kind: "student", user: updated, token: session.token, expiresAt: session.expiresAt };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("sign-out-everywhere")
  @HttpCode(200)
  async signOutEverywhere(@CurrentUser() user: SessionClaims, @Res({ passthrough: true }) response: Response) {
    const { session, user: current } = await this.students.signOutEverywhere(user.sub, user.remember === true);
    this.sessions.attach(response, STUDENT_SESSION_COOKIE, session);
    return { kind: "student", user: current, token: session.token, expiresAt: session.expiresAt };
  }
}
