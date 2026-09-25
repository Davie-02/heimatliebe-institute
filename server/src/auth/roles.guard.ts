import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { ROLES_KEY } from "./roles-key";
import { STAFF_ROLES, type SessionClaims, type StaffContext } from "./session.service";
import { accessForRoute } from "../access/route-access";
import { atLeast, MODULES } from "../access/modules";

const STAFF = new Set<string>(STAFF_ROLES);

/**
 * Runs after JwtAuthGuard. Without a @Roles() list, any signed-in person passes.
 *
 * Students: the route's role list decides.
 *
 * Staff: when a route is open to staff, what decides is MODULE ACCESS — the route's module and
 * level from access/route-access.ts, checked against the person's department defaults and
 * overrides. The system administrator (OWNER) passes everything. A staff route the table doesn't
 * know is refused for everyone but the owner, so a new endpoint is never accidentally opened.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: SessionClaims; staff?: StaffContext | null }>();
    const user = request.user;
    const denied = () => new ForbiddenException("You don't have permission to do this.");
    if (!user) throw denied();

    const routeIsForStaff = requiredRoles.some((role) => STAFF.has(role));
    if (!STAFF.has(user.role) || !routeIsForStaff) {
      if (!requiredRoles.includes(user.role)) throw denied();
      return true;
    }

    if (user.role === "OWNER") return true;

    const rule = accessForRoute(request.method, `${request.baseUrl ?? ""}${request.path}`);
    if (!rule) throw denied();
    if (rule.kind === "staff") return true;

    const access = request.staff?.access;
    if (access && rule.modules.some((module) => atLeast(access[module], rule.level))) return true;

    const names = rule.modules.map((key) => MODULES.find((m) => m.key === key)?.label ?? key).join(" or ");
    throw new ForbiddenException(`You need ${rule.level} access to ${names} for this. Ask your system administrator.`);
  }
}
