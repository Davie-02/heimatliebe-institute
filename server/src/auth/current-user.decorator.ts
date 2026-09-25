import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { SessionClaims } from "./session.service";

/** The decoded session of whoever is calling (set by JwtAuthGuard). */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): SessionClaims => {
  const request = ctx.switchToHttp().getRequest<Request & { user?: SessionClaims }>();
  return request.user as SessionClaims;
});
