import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "../email/email.service";
import { EventsService } from "../events/events.service";
import { ActivityService, type Actor } from "../activity/activity.service";
import { WebhooksService } from "../integrations/webhooks.service";
import { NotificationsService } from "../messaging/notifications.service";
import { StudentAuthService } from "../auth/student-auth.service";
import { frontendUrl } from "../auth/auth.service";
import { atLeast, effectiveAccess } from "../access/modules";
import { applicationReference, invoiceNumber } from "../common/codes";
import { nextStudentNumber } from "../students/student-number";
import { isSafeLink } from "../resources/validate";
import {
  applicationDecisionEmail,
  applicationReceivedEmail,
  enquiryReceivedOfficeEmail,
  examRegistrationEmail,
  newApplicationOfficeEmail,
} from "../email/templates";
import { placementLanguages, publicQuestions, scorePlacement } from "./placement";
import type { AcceptApplicationDto, ApplicationDto, ApplicationStatusDto, EnquiryDto, ExamRegistrationDto, PlacementSubmitDto } from "./admissions.dto";

const dateOnly = (value?: string) => (value ? new Date(`${value.slice(0, 10)}T00:00:00.000Z`) : null);
const clean = (value?: string | null) => (value?.trim() ? value.trim() : null);

/**
 * Everything between a visitor's first question and their first day as a student:
 * placement test, enquiries, online applications (and tracking them), official exam
 * registrations, certificate checks — and, for staff, deciding applications.
 */
@Injectable()
export class AdmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly events: EventsService,
    private readonly activity: ActivityService,
    private readonly webhooks: WebhooksService,
    private readonly notifications: NotificationsService,
    private readonly studentAuth: StudentAuthService
  ) {}

  private async notifyStaffWith(module: "admissions" | "finance", title: string, body: string, link: string) {
    const ids = await this.notifications.staffWithAccess((s) => atLeast(effectiveAccess(s.role, s.department, s.permissions)[module], "edit"));
    await this.notifications.notify("staff", ids, { title, body, link });
  }

  // ── Placement test ──────────────────────────────────────────────────────────

  placementLanguages() {
    return placementLanguages();
  }

  placementQuestions(language: string) {
    const questions = publicQuestions(language);
    if (!questions.length) throw new NotFoundException("There's no placement test for that language yet.");
    return questions;
  }

  async submitPlacement(dto: PlacementSubmitDto) {
    if (!placementLanguages().includes(dto.language)) throw new BadRequestException("There's no placement test for that language yet.");
    const result = scorePlacement(dto.language, dto.answers);
    const attempt = await this.prisma.placementAttempt.create({
      data: {
        name: dto.name.trim(),
        email: clean(dto.email)?.toLowerCase() ?? null,
        phone: clean(dto.phone),
        language: dto.language,
        answers: dto.answers as Prisma.InputJsonValue,
        score: result.score,
        total: result.total,
        recommendedLevel: result.recommendedLevel,
      },
    });
    this.events.emit(["placement-results"]);
    return { id: attempt.id, ...result };
  }

  // ── Applications ────────────────────────────────────────────────────────────

  async apply(dto: ApplicationDto, ip?: string) {
    if (dto.website) return { reference: applicationReference() }; // a bot filled the hidden field
    if (dto.paymentProofUrl && !isSafeLink(dto.paymentProofUrl)) throw new BadRequestException("Upload the payment proof again.");
    const email = dto.email.trim().toLowerCase();
    const recent = await this.prisma.application.count({ where: { email, createdAt: { gt: new Date(Date.now() - 10 * 60_000) } } });
    if (recent >= 3) throw new BadRequestException("We've already received your application. Check your email for the reference number.");

    const application = await this.prisma.application.create({
      data: {
        reference: applicationReference(),
        name: dto.name.trim(),
        email,
        phone: dto.phone.trim(),
        course: dto.course.trim(),
        level: dto.level,
        dateOfBirth: dateOnly(dto.dateOfBirth),
        gender: clean(dto.gender),
        nationality: clean(dto.nationality),
        address: clean(dto.address),
        guardianName: clean(dto.guardianName),
        guardianPhone: clean(dto.guardianPhone),
        preferredSchedule: clean(dto.preferredSchedule),
        motivation: clean(dto.motivation),
        source: clean(dto.source),
        placementAttemptId: clean(dto.placementAttemptId),
        paymentProofUrl: clean(dto.paymentProofUrl),
      },
    });
    const trackUrl = `${frontendUrl()}/apply/track?reference=${application.reference}`;
    void this.email.send({ to: email, ...applicationReceivedEmail({ name: application.name, reference: application.reference, course: application.course, trackUrl }) });
    void this.email.notifyOffice(`New application: ${application.name}`, newApplicationOfficeEmail({ name: application.name, reference: application.reference, course: application.course, url: `${frontendUrl()}/admin/r/applications/${application.id}` }).html);
    await this.notifyStaffWith("admissions", `New application: ${application.name}`, `${application.course} · ${application.level}`, `/admin/r/applications/${application.id}`);
    await this.activity.log({ kind: "public", name: application.name, ip }, "applied", `${application.name} applied for ${application.course}`, { type: "applications", id: application.id });
    this.events.emit(["applications"]);
    this.webhooks.dispatch("applications.created", { id: application.id, reference: application.reference, name: application.name, email, course: application.course, level: application.level });
    return { reference: application.reference };
  }

  /** Needs the reference AND the email it was sent from, so references can't be tried one by one. */
  async track(reference: string, email: string) {
    const application = await this.prisma.application.findFirst({
      where: { reference: reference.trim().toUpperCase(), email: { equals: email.trim(), mode: "insensitive" } },
      select: { reference: true, name: true, course: true, level: true, status: true, createdAt: true, reviewedAt: true },
    });
    if (!application) throw new NotFoundException("We couldn't find an application with that reference and email.");
    return application;
  }

  /**
   * Accepting an application does the whole hand-over in one step: creates the student account
   * (or links an existing one with the same email), places them in a class, raises the first
   * invoice, and emails them their portal invitation.
   */
  async accept(id: string, dto: AcceptApplicationDto, actor: Actor & { id: string; name: string }) {
    const application = await this.prisma.application.findUnique({ where: { id } });
    if (!application) throw new NotFoundException("Application not found.");
    if (application.status === "accepted" && application.studentId) throw new ConflictException("This application has already been accepted.");
    if (dto.classId) {
      const cls = await this.prisma.classGroup.findUnique({ where: { id: dto.classId }, include: { _count: { select: { enrollments: { where: { status: "active" } } } } } });
      if (!cls) throw new BadRequestException("That class wasn't found.");
      if (cls._count.enrollments >= cls.maxStudents) throw new BadRequestException(`${cls.name} is full (${cls.maxStudents} students).`);
    }

    const student = await this.createStudentWithRetry(async (studentNo) =>
      this.prisma.$transaction(async (tx) => {
        const existing = await tx.student.findUnique({ where: { email: application.email } });
        const student =
          existing ??
          (await tx.student.create({
            data: {
              studentNo,
              name: application.name,
              email: application.email,
              phone: application.phone,
              course: application.course,
              level: dto.level ?? application.level,
              dateOfBirth: application.dateOfBirth,
              gender: application.gender,
              nationality: application.nationality,
              address: application.address,
              guardianName: application.guardianName,
              guardianPhone: application.guardianPhone,
            },
          }));
        if (dto.classId) {
          await tx.enrollment.upsert({
            where: { classId_studentId: { classId: dto.classId, studentId: student.id } },
            create: { classId: dto.classId, studentId: student.id },
            update: { status: "active" },
          });
        }
        if (dto.invoiceAmount && dto.invoiceAmount > 0) {
          await tx.invoice.create({
            data: {
              invoiceNo: invoiceNumber(),
              studentId: student.id,
              description: dto.invoiceDescription?.trim() || `Tuition – ${application.course}`,
              amount: dto.invoiceAmount,
              dueDate: dateOnly(dto.invoiceDueDate) ?? new Date(Date.now() + 14 * 86400_000),
            },
          });
        }
        // The student relation is one-to-one: release it from any earlier application by the same person first.
        await tx.application.updateMany({ where: { studentId: student.id, NOT: { id } }, data: { studentId: null } });
        await tx.application.update({ where: { id }, data: { status: "accepted", studentId: student.id, reviewedAt: new Date(), reviewedBy: actor.name } });
        return student;
      })
    );

    let invitation: { sent: boolean; error?: string } = { sent: false };
    if (dto.sendInvitation !== false && !student.passwordHash) invitation = await this.studentAuth.invite(student.id);
    void this.email.send({ to: application.email, ...applicationDecisionEmail({ name: application.name, reference: application.reference, status: "accepted", message: dto.message }) });

    await this.activity.log(actor, "accepted", `Accepted ${application.name}'s application (${student.studentNo})`, { type: "applications", id });
    this.events.emit(["applications", "students", "enrollments", "invoices"]);
    this.events.noteWrite();
    this.webhooks.dispatch("applications.accepted", { applicationId: id, studentId: student.id, studentNo: student.studentNo, name: student.name, email: student.email });
    return { student: { id: student.id, studentNo: student.studentNo, name: student.name }, invitation };
  }

  /** Two admissions officers accepting at the same moment could pick the same student number; the second simply retries. */
  private async createStudentWithRetry<T>(work: (studentNo: string) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await work(await nextStudentNumber(this.prisma));
      } catch (error) {
        const clash = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && String(error.meta?.target).includes("studentNo");
        if (!clash || attempt >= 4) throw error;
      }
    }
  }

  async setStatus(id: string, dto: ApplicationStatusDto, actor: Actor & { id: string; name: string }) {
    const application = await this.prisma.application.findUnique({ where: { id } });
    if (!application) throw new NotFoundException("Application not found.");
    if (application.status === "accepted") throw new BadRequestException("This application has been accepted; change the student record instead.");
    const updated = await this.prisma.application.update({ where: { id }, data: { status: dto.status, reviewedAt: new Date(), reviewedBy: actor.name } });
    if (dto.notify !== false && dto.status !== "pending") {
      void this.email.send({ to: application.email, ...applicationDecisionEmail({ name: application.name, reference: application.reference, status: dto.status, message: dto.message }) });
    }
    await this.activity.log(actor, dto.status, `Marked ${application.name}'s application as ${dto.status}`, { type: "applications", id }, {
      kind: "updated",
      model: "application",
      id,
      before: { status: application.status, reviewedAt: application.reviewedAt?.toISOString() ?? null, reviewedBy: application.reviewedBy },
      after: { status: updated.status, reviewedAt: updated.reviewedAt?.toISOString() ?? null, reviewedBy: updated.reviewedBy },
      topic: "applications",
    });
    this.events.emit(["applications"]);
    this.webhooks.dispatch(`applications.${dto.status}`, { id, reference: application.reference });
    return updated;
  }

  // ── Enquiries ───────────────────────────────────────────────────────────────

  async enquire(dto: EnquiryDto, ip?: string) {
    if (dto.website) return { received: true };
    if (!dto.email && !dto.phone) throw new BadRequestException("Leave an email address or phone number so we can reply.");
    const enquiry = await this.prisma.enquiry.create({
      data: { name: dto.name.trim(), email: clean(dto.email)?.toLowerCase() ?? null, phone: clean(dto.phone), interest: clean(dto.interest), message: dto.message.trim(), channel: "website" },
    });
    void this.email.notifyOffice(`New enquiry from ${enquiry.name}`, enquiryReceivedOfficeEmail({ name: enquiry.name, interest: enquiry.interest, message: enquiry.message, url: `${frontendUrl()}/admin/r/enquiries` }).html);
    await this.notifyStaffWith("admissions", `New enquiry from ${enquiry.name}`, enquiry.interest ?? enquiry.message?.slice(0, 120) ?? "", "/admin/r/enquiries");
    await this.activity.log({ kind: "public", name: enquiry.name, ip }, "enquired", `Enquiry from ${enquiry.name}`, { type: "enquiries", id: enquiry.id });
    this.events.emit(["enquiries"]);
    this.webhooks.dispatch("enquiries.created", { id: enquiry.id, name: enquiry.name, email: enquiry.email, phone: enquiry.phone, interest: enquiry.interest });
    return { received: true };
  }

  // ── Official exams ──────────────────────────────────────────────────────────

  async registerForExam(dto: ExamRegistrationDto, ip?: string) {
    if (dto.website) return { registered: true };
    if (dto.paymentProofUrl && !isSafeLink(dto.paymentProofUrl)) throw new BadRequestException("Upload the payment proof again.");
    const session = await this.prisma.examSession.findFirst({ where: { id: dto.sessionId, published: true }, include: { _count: { select: { registrations: { where: { status: { not: "cancelled" } } } } } } });
    if (!session) throw new NotFoundException("That exam session isn't open.");
    const today = new Date(new Date().toISOString().slice(0, 10));
    if ((session.registrationDeadline && session.registrationDeadline < today) || session.examDate < today) throw new BadRequestException("Registration for this exam has closed.");
    if (session.capacity && session._count.registrations >= session.capacity) throw new BadRequestException("This exam session is full.");
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.examRegistration.findFirst({ where: { sessionId: session.id, email, status: { not: "cancelled" } } })) {
      throw new ConflictException("You're already registered for this exam.");
    }
    const registration = await this.prisma.examRegistration.create({
      data: {
        sessionId: session.id,
        name: dto.name.trim(),
        email,
        phone: dto.phone.trim(),
        dateOfBirth: dateOnly(dto.dateOfBirth),
        passportNo: clean(dto.passportNo),
        modules: clean(dto.modules) ?? session.modules,
        paymentProofUrl: clean(dto.paymentProofUrl),
      },
    });
    void this.email.send({ to: email, ...examRegistrationEmail({ name: registration.name, title: session.title, date: session.examDate.toISOString().slice(0, 10) }) });
    await this.notifyStaffWith("admissions", `Exam registration: ${registration.name}`, session.title, "/admin/r/exam-registrations");
    await this.activity.log({ kind: "public", name: registration.name, ip }, "registered", `${registration.name} registered for ${session.title}`, { type: "exam-registrations", id: registration.id });
    this.events.emit(["exam-registrations"]);
    return { registered: true };
  }

  // ── Certificates ────────────────────────────────────────────────────────────

  async verifyCertificate(code: string) {
    const value = code.trim().toUpperCase();
    const certificate = await this.prisma.certificate.findFirst({
      where: { OR: [{ verificationCode: value }, { certificateNo: value }] },
      select: { certificateNo: true, holderName: true, course: true, level: true, grade: true, hours: true, issuedAt: true, revoked: true },
    });
    if (!certificate) throw new NotFoundException("No certificate matches that code. Check it and try again.");
    return { ...certificate, valid: !certificate.revoked };
  }

  async summary() {
    const [pending, reviewing, newEnquiries, followUps, examRegistrations] = await Promise.all([
      this.prisma.application.count({ where: { status: "pending" } }),
      this.prisma.application.count({ where: { status: "reviewing" } }),
      this.prisma.enquiry.count({ where: { status: "new" } }),
      this.prisma.enquiry.count({ where: { status: { in: ["new", "contacted", "follow_up"] }, nextFollowUp: { lte: new Date() } } }),
      this.prisma.examRegistration.count({ where: { status: "pending" } }),
    ]);
    return { pending, reviewing, newEnquiries, followUps, examRegistrations };
  }
}
