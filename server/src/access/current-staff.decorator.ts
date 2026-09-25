import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { AccessMap } from "./modules";

/** Who is calling a staff route: id, role, name, department and module access (set by JwtAuthGuard). */
export interface StaffActor {
  sub: string;
  role: string;
  name: string;
  email: string;
  department: string;
  access: AccessMap;
}

export const CurrentStaff = createParamDecorator((_data: unknown, ctx: ExecutionContext): StaffActor => {
  const request = ctx.switchToHttp().getRequest<Request & { user?: Omit<StaffActor, "access" | "department">; staff?: { access: AccessMap; department: string } | null }>();
  return {
    ...(request.user as Omit<StaffActor, "access" | "department">),
    department: request.staff?.department ?? "general",
    access: request.staff?.access ?? ({} as AccessMap),
  };
});
