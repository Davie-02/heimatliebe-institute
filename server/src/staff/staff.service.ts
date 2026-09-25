import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "../email/email.service";
import { staffInvitationEmail } from "../email/templates";
import { SessionService } from "../auth/session.service";
import { ActivityService, type Actor } from "../activity/activity.service";
import { EventsService } from "../events/events.service";
import { atLeast, cleanOverrides, DEPARTMENTS, effectiveAccess, LEVELS, MODULES, type AccessMap } from "../access/modules";
import { generateTempPassword, TEMP_PASSWORD_TTL_MS } from "../security/temp-password";
import { staffNumber } from "../common/codes";
import { frontendUrl } from "../auth/auth.service";
import { isSafeLink } from "../resources/validate";
import type { InviteStaffDto, UpdateMyProfileDto, UpdateStaffDto } from "./staff.dto";

export interface StaffViewer {
  sub: string;
  name: string;
  role: string;
  access: AccessMap;
  ip?: string;
}

const PUBLIC_FIELDS = {
  id: true, staffNo: true, name: true, email: true, phone: true, role: true, department: true, jobTitle: true, bio: true, photoUrl: true,
  permissions: true, isActive: true, mustChangePassword: true, totpEnabled: true, lastLoginAt: true, createdAt: true,
} as const;

/**
 * Staff accounts and who can do what.
 *
 * - HR (manage) and System (manage) can invite staff, correct their details and deactivate them.
 * - Only system administrators change what someone can access (department, role, per-module
 *   overrides), create or change other system administrators, or reset someone's two-step sign-in —
 *   and only after confirming it's them (password + code) within the last 10 minutes.
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly sessions: SessionService,
    private readonly activity: ActivityService,
    private readonly events: EventsService
  ) {}

  meta() {
    return {
      modules: MODULES,
      levels: LEVELS,
      departments: Object.entries(DEPARTMENTS).map(([key, value]) => ({ key, label: value.label, access: value.access })),
    };
  }

  private isSystemAdmin(viewer: StaffViewer) {
    return viewer.role === "OWNER" || atLeast(viewer.access.system, "manage");
  }

  private async requireStepUp(viewer: StaffViewer) {
    const me = await this.prisma.staff.findUniqueOrThrow({ where: { id: viewer.sub }, select: { stepUpUntil: true } });
    if (!me.stepUpUntil || me.stepUpUntil < new Date()) {
      throw new ForbiddenException({ statusCode: 403, code: "STEP_UP_REQUIRED", message: "Please confirm it's you before changing access." });
    }
  }

  async list(query: { q?: string; department?: string; active?: string }) {
    const rows = await this.prisma.staff.findMany({
      where: {
        ...(query.department ? { department: query.department } : {}),
        ...(query.active === "true" ? { isActive: true } : query.active === "false" ? { isActive: false } : {}),
        ...(query.q ? { OR: [{ name: { contains: query.q, mode: "insensitive" } }, { email: { contains: query.q, mode: "insensitive" } }] } : {}),
      },
      select: PUBLIC_FIELDS,
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      take: 500,
    });
    return rows.map((row) => ({ ...row, access: effectiveAccess(row.role, row.department, row.permissions) }));
  }

  async get(id: string) {
    const row = await this.prisma.staff.findUnique({ where: { id }, select: PUBLIC_FIELDS });
    if (!row) throw new NotFoundException("Staff member not found.");
    return { ...row, access: effectiveAccess(row.role, row.department, row.permissions) };
  }

  /** Active colleagues for pickers (class teacher, enquiry owner, message recipients). */
  options(q?: string) {
    return this.prisma.staff.findMany({
      where: { isActive: true, ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) },
      select: { id: true, name: true, department: true, jobTitle: true },
      orderBy: { name: "asc" },
      take: 50,
    });
  }

  /** Creates the account with a one-time password and emails it. Returns the password too, for handing over in person if email isn't set up. */
  async invite(dto: InviteStaffDto, viewer: StaffViewer) {
    const role = dto.role ?? "EMPLOYEE";
    if (role !== "EMPLOYEE" && !this.isSystemAdmin(viewer)) throw new ForbiddenException("Only a system administrator can create managers or administrators.");
    if (role === "OWNER") {
      if (viewer.role !== "OWNER") throw new ForbiddenException("Only a system administrator can create another one.");
      await this.requireStepUp(viewer);
    }
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.staff.findUnique({ where: { email } })) throw new ConflictException("Someone already has a staff account with that email.");

    const tempPassword = generateTempPassword();
    const staff = await this.prisma.staff.create({
      data: {
        name: dto.name.trim(),
        email,
        phone: dto.phone?.trim() || null,
        jobTitle: dto.jobTitle?.trim() || null,
        department: dto.department,
        role,
        staffNo: staffNumber(),
        passwordHash: await bcrypt.hash(tempPassword, 12),
        mustChangePassword: true,
        tempPasswordExpiresAt: new Date(Date.now() + TEMP_PASSWORD_TTL_MS),
      },
      select: PUBLIC_FIELDS,
    });
    const sent = await this.email.sendChecked({
      to: email,
      ...staffInvitationEmail({ name: staff.name, email, tempPassword, signInUrl: `${frontendUrl()}/sign-in`, invitedBy: viewer.name }),
    });
    await this.activity.log({ kind: "staff", id: viewer.sub, name: viewer.name, ip: viewer.ip }, "invited", `Invited ${staff.name} (${DEPARTMENTS[staff.department]?.label ?? staff.department})`, { type: "staff", id: staff.id });
    this.events.emit(["staff"]);
    return { staff, emailSent: sent.ok, emailError: sent.error, tempPassword: sent.ok ? undefined : tempPassword };
  }

  async resendInvitation(id: string, viewer: StaffViewer) {
    const staff = await this.prisma.staff.findUnique({ where: { id } });
    if (!staff) throw new NotFoundException("Staff member not found.");
    if (staff.role === "OWNER" && viewer.role !== "OWNER") throw new ForbiddenException("Only a system administrator can do this for another administrator.");
    const tempPassword = generateTempPassword();
    await this.prisma.staff.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(tempPassword, 12), mustChangePassword: true, tempPasswordExpiresAt: new Date(Date.now() + TEMP_PASSWORD_TTL_MS), passwordChangedAt: new Date() },
    });
    this.sessions.forgetStaff(id);
    const sent = await this.email.sendChecked({
      to: staff.email,
      ...staffInvitationEmail({ name: staff.name, email: staff.email, tempPassword, signInUrl: `${frontendUrl()}/sign-in`, invitedBy: viewer.name }),
    });
    await this.activity.log({ kind: "staff", id: viewer.sub, name: viewer.name, ip: viewer.ip }, "invited", `Sent a new invitation to ${staff.name}`, { type: "staff", id });
    return { emailSent: sent.ok, emailError: sent.error, tempPassword: sent.ok ? undefined : tempPassword };
  }

  async update(id: string, dto: UpdateStaffDto, viewer: StaffViewer) {
    const existing = await this.prisma.staff.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Staff member not found.");
    const changesAccess = dto.role !== undefined || dto.permissions !== undefined || dto.department !== undefined;
    const changesStatus = dto.isActive !== undefined;

    if (existing.role === "OWNER" && viewer.role !== "OWNER") throw new ForbiddenException("Only a system administrator can change another administrator.");
    if (changesAccess && !this.isSystemAdmin(viewer)) throw new ForbiddenException("Only a system administrator can change what someone can access.");
    if (dto.role === "OWNER" && viewer.role !== "OWNER") throw new ForbiddenException("Only a system administrator can make someone an administrator.");
    if (id === viewer.sub && (changesAccess || dto.isActive === false)) throw new BadRequestException("You can't change your own access or deactivate yourself.");
    if (changesAccess || existing.role === "OWNER" || (changesStatus && dto.isActive === false)) await this.requireStepUp(viewer);
    if (existing.role === "OWNER" && (dto.role && dto.role !== "OWNER" || dto.isActive === false)) {
      const owners = await this.prisma.staff.count({ where: { role: "OWNER", isActive: true } });
      if (owners <= 1) throw new BadRequestException("There must always be at least one active system administrator.");
    }

    const data = {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.phone !== undefined ? { phone: dto.phone.trim() || null } : {}),
      ...(dto.jobTitle !== undefined ? { jobTitle: dto.jobTitle.trim() || null } : {}),
      ...(dto.bio !== undefined ? { bio: dto.bio.trim() || null } : {}),
      ...(dto.department !== undefined ? { department: dto.department } : {}),
      ...(dto.role !== undefined ? { role: dto.role } : {}),
      ...(dto.permissions !== undefined ? { permissions: cleanOverrides(dto.permissions) } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    };
    const updated = await this.prisma.staff.update({ where: { id }, data, select: PUBLIC_FIELDS });
    this.sessions.forgetStaff(id);
    const what = Object.keys(data).join(", ");
    await this.activity.log({ kind: "staff", id: viewer.sub, name: viewer.name, ip: viewer.ip }, changesAccess ? "access-changed" : "updated", `Changed ${updated.name}'s account (${what})`, { type: "staff", id });
    this.events.emit(["staff"]);
    return { ...updated, access: effectiveAccess(updated.role, updated.department, updated.permissions) };
  }

  async resetTwoFactor(id: string, viewer: StaffViewer) {
    if (!this.isSystemAdmin(viewer)) throw new ForbiddenException("Only a system administrator can reset two-step verification.");
    if (id === viewer.sub) throw new BadRequestException("Use My security to change your own two-step verification.");
    await this.requireStepUp(viewer);
    const staff = await this.prisma.staff.update({ where: { id }, data: { totpEnabled: false, totpSecret: null, recoveryCodeHashes: [], lastTotpStep: null, sessionsRevokedAt: new Date() } });
    this.sessions.forgetStaff(id);
    await this.activity.log({ kind: "staff", id: viewer.sub, name: viewer.name, ip: viewer.ip }, "security", `Reset two-step verification for ${staff.name}`, { type: "staff", id });
    return { reset: true };
  }

  /** Anyone can keep their own phone, photo and short bio up to date. */
  async updateMyProfile(staffId: string, dto: UpdateMyProfileDto) {
    if (dto.photoUrl && !isSafeLink(dto.photoUrl)) throw new BadRequestException("Upload the photo again.");
    const updated = await this.prisma.staff.update({
      where: { id: staffId },
      data: {
        ...(dto.phone !== undefined ? { phone: dto.phone.trim() || null } : {}),
        ...(dto.bio !== undefined ? { bio: dto.bio.trim() || null } : {}),
        ...(dto.photoUrl !== undefined ? { photoUrl: dto.photoUrl || null } : {}),
      },
      select: PUBLIC_FIELDS,
    });
    this.events.emit(["staff"]);
    return updated;
  }

  /** Colleagues and how to reach them (every staff member can see this). */
  directory() {
    return this.prisma.staff.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true, phone: true, department: true, jobTitle: true, photoUrl: true, bio: true },
      orderBy: { name: "asc" },
    });
  }
}
