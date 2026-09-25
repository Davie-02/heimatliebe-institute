import { applyDecorators, SetMetadata, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { RolesGuard } from "./roles.guard";
import { STAFF_ROLES } from "./session.service";

import { ROLES_KEY } from "./roles-key";
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/** Signed-in staff only; what they may do is decided by access/route-access.ts. */
export const StaffRoute = () => applyDecorators(UseGuards(JwtAuthGuard, RolesGuard), Roles(...STAFF_ROLES));

/** Signed-in students only. */
export const StudentRoute = () => applyDecorators(UseGuards(JwtAuthGuard, RolesGuard), Roles("STUDENT"));
