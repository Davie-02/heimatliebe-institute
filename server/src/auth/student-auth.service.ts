import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import type { Student } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "../email/email.service";
import { passwordChangedEmail, passwordResetEmail, studentInvitationEmail } from "../email/templates";
import { SessionService, type IssuedSession } from "./session.service";
import { CLEARED_LOCK_STATE, isLocked, stateAfterFailure } from "../security/lockout";
import { DUMMY_HASH, frontendUrl, hashToken } from "./auth.service";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

/** What the browser is told about a signed-in student. */
export interface StudentUser {
  id: string;
  studentNo: string;
  name: string;
  email: string;
  phone: string | null;
  course: string | null;
  level: string | null;
  status: string;
  photoUrl: string | null;
}

export function toStudentUser(student: Student): StudentUser {
  return {
    id: student.id,
    studentNo: student.studentNo,
    name: student.name,
    email: student.email,
    phone: student.phone,
    course: student.course,
    level: student.level,
    status: student.status,
    photoUrl: student.photoUrl,
  };
}

/**
 * Student accounts: invitations ("choose your password"), password sign-in with lockout,
 * Google/Facebook sign-in for an existing account, password reset, change and "sign out everywhere".
 * Students don't register themselves: an account is created when admissions accepts an application.
 */
@Injectable()
export class StudentAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly sessions: SessionService
  ) {}

  async checkPassword(email: string, password: string): Promise<{ student: Student | null; matches: boolean; locked: boolean }> {
    const student = await this.prisma.student.findFirst({ where: { email: { equals: email.trim().toLowerCase(), mode: "insensitive" } } });
    const locked = Boolean(student?.lockedUntil && isLocked(student.lockedUntil));
    const matches = await bcrypt.compare(password, student?.passwordHash ?? DUMMY_HASH);
    const usable = Boolean(student && student.isActive && student.status !== "suspended" && student.passwordHash);
    return { student, matches: usable && matches && !locked, locked };
  }

  async recordFailure(student: { id: string; failedLoginCount: number }): Promise<void> {
    await this.prisma.student.update({ where: { id: student.id }, data: stateAfterFailure(student.failedLoginCount) });
  }

  async completeSignIn(student: Student, remember: boolean): Promise<{ session: IssuedSession; user: StudentUser }> {
    await this.prisma.student.update({ where: { id: student.id }, data: { ...CLEARED_LOCK_STATE, lastLoginAt: new Date() } });
    const session = await this.sessions.issue({ sub: student.id, role: "STUDENT", name: student.name, email: student.email }, remember);
    return { session, user: toStudentUser(student) };
  }

  async getSession(studentId: string): Promise<{ user: StudentUser }> {
    const student = await this.prisma.student.findUnique({ where: { id: studentId } });
    if (!student || !student.isActive) throw new UnauthorizedException("This account is no longer active.");
    return { user: toStudentUser(student) };
  }

  /** Emails a new (or existing) student a link to choose their password. Returns whether the email went out. */
  async invite(studentId: string): Promise<{ sent: boolean; error?: string }> {
    const student = await this.prisma.student.findUniqueOrThrow({ where: { id: studentId } });
    const rawToken = randomBytes(32).toString("hex");
    await this.prisma.authToken.updateMany({ where: { realm: "student", accountId: studentId, purpose: "invite", usedAt: null }, data: { usedAt: new Date() } });
    await this.prisma.authToken.create({
      data: { realm: "student", accountId: studentId, purpose: "invite", tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
    });
    const result = await this.email.sendChecked({
      to: student.email,
      ...studentInvitationEmail({ name: student.name, studentNo: student.studentNo, url: `${frontendUrl()}/set-password?token=${rawToken}` }),
    });
    return { sent: result.ok, error: result.error };
  }

  async requestPasswordReset(email: string): Promise<void> {
    const student = await this.prisma.student.findFirst({ where: { email: { equals: email.trim().toLowerCase(), mode: "insensitive" } } });
    if (!student || !student.isActive) return;
    const rawToken = randomBytes(32).toString("hex");
    await this.prisma.authToken.create({
      data: { realm: "student", accountId: student.id, purpose: "reset", tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    });
    void this.email.send({ to: student.email, ...passwordResetEmail(`${frontendUrl()}/reset-password?token=${rawToken}`) }).catch(() => undefined);
  }

  /** Sets a password from an invitation or reset link. Returns false when the link isn't a student link. */
  async setPasswordFromToken(rawToken: string, newPassword: string): Promise<Student | null> {
    const token = await this.prisma.authToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
    if (!token || token.realm !== "student") return null;
    if (token.usedAt || token.expiresAt < new Date()) throw new BadRequestException("This link is invalid or has expired. Ask the office for a new one.");
    const student = await this.prisma.student.findUnique({ where: { id: token.accountId } });
    if (!student) throw new BadRequestException("This link is invalid or has expired.");
    const personal = [student.name, student.email].flatMap((value) => value.split("@")[0].toLowerCase().split(/[^a-z0-9]+/)).filter((word) => word.length >= 4);
    if (personal.some((word) => newPassword.toLowerCase().includes(word))) throw new BadRequestException("Don't include your name or email in your password.");

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.authToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
      if (claimed.count !== 1) throw new BadRequestException("This link is invalid or has expired.");
      await tx.authToken.updateMany({ where: { realm: "student", accountId: student.id, usedAt: null }, data: { usedAt: now } });
      return tx.student.update({ where: { id: student.id }, data: { passwordHash: await bcrypt.hash(newPassword, 12), passwordChangedAt: now, ...CLEARED_LOCK_STATE } });
    });
    this.sessions.forget("STUDENT", student.id);
    return updated;
  }

  async changePassword(studentId: string, currentPassword: string, newPassword: string, remember: boolean) {
    const student = await this.prisma.student.findUniqueOrThrow({ where: { id: studentId } });
    if (!student.passwordHash || !(await bcrypt.compare(currentPassword, student.passwordHash))) throw new UnauthorizedException("Your current password isn't right.");
    if (currentPassword === newPassword) throw new BadRequestException("Choose a password you haven't been using.");
    const updated = await this.prisma.student.update({ where: { id: studentId }, data: { passwordHash: await bcrypt.hash(newPassword, 12), passwordChangedAt: new Date() } });
    this.sessions.forget("STUDENT", studentId);
    void this.email.send({ to: student.email, ...passwordChangedEmail(student.name) }).catch(() => undefined);
    return this.completeSignIn(updated, remember);
  }

  async signOutEverywhere(studentId: string, remember: boolean) {
    await this.sessions.revokeAll("STUDENT", studentId);
    const student = await this.prisma.student.findUniqueOrThrow({ where: { id: studentId } });
    return this.completeSignIn(student, remember);
  }
}
