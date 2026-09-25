import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { readCookie } from "./cookies";
import { STAFF_SESSION_COOKIE, STUDENT_SESSION_COOKIE } from "./session-cookie";
import { SESSION_ROLES, SessionService, type SessionClaims } from "./session.service";
import { allowedBeforeTwoFactorSetup, ownerIpAllowed, ownerTwoFactorRequired } from "../access/system-admin-policy";

/** Where the token comes from: `Authorization: Bearer` first (the cookie-free fallback), then the staff cookie, then the student cookie. */
export function extractSessionToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);
  return readCookie(request.headers.cookie, STAFF_SESSION_COOKIE) ?? readCookie(request.headers.cookie, STUDENT_SESSION_COOKIE) ?? null;
}

/**
 * Lets a request through only if it carries a genuine, current sign-in.
 * Put it before RolesGuard: @UseGuards(JwtAuthGuard, RolesGuard) — or use @StaffRoute() / @StudentRoute().
 *
 * "Genuine": the token's signature checks out and it hasn't expired.
 * "Current": the account still exists and is active, and its password hasn't changed since
 * (SessionService.assertStillValid).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly sessions: SessionService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractSessionToken(request);
    if (!token) throw new UnauthorizedException("Please sign in.");

    let payload: SessionClaims;
    try {
      payload = await this.jwtService.verifyAsync<SessionClaims>(token);
    } catch {
      throw new UnauthorizedException("Your session has ended. Please sign in again.");
    }

    // Tokens with any other role (notably "password ok, 2FA still needed") prove nothing about being signed in.
    if (!(SESSION_ROLES as readonly string[]).includes(payload.role)) {
      throw new UnauthorizedException("Invalid session.");
    }

    const staff = await this.sessions.assertStillValid(payload);

    if (payload.role === "OWNER") {
      if (!ownerIpAllowed(request.ip)) throw new UnauthorizedException("Please sign in again.");
      if (ownerTwoFactorRequired() && staff && !staff.totpEnabled && !allowedBeforeTwoFactorSetup(request.path)) {
        throw new ForbiddenException({
          statusCode: 403,
          code: "TWO_FACTOR_SETUP_REQUIRED",
          message: "System administrators must turn on two-step verification before continuing. Open My security to set it up.",
        });
      }
    }

    // Attach who is calling (and, for staff, their module access) for guards and handlers.
    (request as Request & { user?: unknown; staff?: unknown }).user = payload;
    (request as Request & { staff?: unknown }).staff = staff;
    return true;
  }
}
