import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { EventsService } from "../events/events.service";
import { ActivityService } from "../activity/activity.service";
import { NotificationsService } from "../messaging/notifications.service";
import { WebhooksService } from "../integrations/webhooks.service";
import { SiteContentService } from "../site/site-content.service";
import { atLeast, effectiveAccess } from "../access/modules";
import { isSafeLink } from "../resources/validate";
import { grade, studentPaper, type Question } from "../exams/grading";
import { attemptParts } from "../teaching/teaching.service";
import { balanceOf } from "../finance/invoice-status";
import type { EvaluationDto, ExamAnswersDto, PaymentProofDto, ProfileDto, ScholarshipApplyDto, SubmitAssignmentDto } from "./portal.dto";

/** Extra minutes allowed after an exam's time runs out, for slow connections. */
const GRACE_MS = 2 * 60_000;

/**
 * The student portal: everything a signed-in student sees and does. Every query is limited to
 * the student's own records and the classes they're enrolled in.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
    private readonly webhooks: WebhooksService,
    private readonly content: SiteContentService
  ) {}

  private async classIds(studentId: string): Promise<string[]> {
    const rows = await this.prisma.enrollment.findMany({ where: { studentId, status: { in: ["active", "completed"] } }, select: { classId: true } });
    return rows.map((r) => r.classId);
  }

  private async activeClassIds(studentId: string): Promise<string[]> {
    const rows = await this.prisma.enrollment.findMany({ where: { studentId, status: "active" }, select: { classId: true } });
    return rows.map((r) => r.classId);
  }

  async dashboard(studentId: string) {
    const classIds = await this.activeClassIds(studentId);
    const now = new Date();
    const [today, dueSoon, openExams, invoices, announcements, attendance] = await Promise.all([
      this.prisma.timetableEntry.findMany({
        where: { classId: { in: classIds }, dayOfWeek: now.getDay() },
        include: { class: { select: { name: true, room: true, meetingUrl: true, mode: true } } },
        orderBy: { startTime: "asc" },
      }),
      this.prisma.assignment.findMany({
        where: { classId: { in: classIds }, published: true, dueAt: { gte: now }, submissions: { none: { studentId } } },
        select: { id: true, title: true, dueAt: true, class: { select: { name: true } } },
        orderBy: { dueAt: "asc" },
        take: 5,
      }),
      this.prisma.exam.findMany({
        where: { classId: { in: classIds }, published: true, OR: [{ closesAt: null }, { closesAt: { gte: now } }], attempts: { none: { studentId, submittedAt: { not: null } } } },
        select: { id: true, title: true, opensAt: true, closesAt: true, durationMinutes: true },
        orderBy: { opensAt: "asc" },
        take: 5,
      }),
      this.prisma.invoice.findMany({ where: { studentId, status: { in: ["pending", "partial", "overdue"] } }, select: { amount: true, discount: true, paid: true, dueDate: true, status: true } }),
      this.announcements(),
      this.prisma.attendance.groupBy({ by: ["status"], where: { studentId }, _count: true }),
    ]);
    const total = attendance.reduce((s, r) => s + r._count, 0);
    const present = attendance.filter((r) => r.status === "present" || r.status === "late").reduce((s, r) => s + r._count, 0);
    const institution = await this.content.get("institution");
    return {
      today,
      dueSoon,
      openExams,
      balance: invoices.reduce((sum, i) => sum + balanceOf(i), 0),
      overdue: invoices.filter((i) => i.status === "overdue").length,
      currency: institution.currency,
      attendanceRate: total ? Math.round((present / total) * 100) : null,
      attendanceAlert: institution.attendanceAlertThreshold,
      announcements: announcements.slice(0, 3),
    };
  }

  announcements() {
    const today = new Date(new Date().toISOString().slice(0, 10));
    return this.prisma.announcement.findMany({
      where: { published: true, audience: { in: ["all", "students", "public"] }, OR: [{ expiresAt: null }, { expiresAt: { gte: today } }] },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: 30,
    });
  }

  async classes(studentId: string) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { studentId, status: { in: ["active", "completed", "waitlisted"] } },
      include: {
        class: {
          select: {
            id: true, name: true, level: true, room: true, schedule: true, mode: true, meetingUrl: true, startDate: true, endDate: true, status: true,
            course: { select: { title: true, language: true } },
            teacher: { select: { id: true, name: true, photoUrl: true } },
            timetable: { orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    const evaluations = await this.prisma.courseEvaluation.findMany({ where: { studentId }, select: { classId: true } });
    const evaluated = new Set(evaluations.map((e) => e.classId));
    return enrollments.map((e) => ({ ...e.class, enrollment: e.status, evaluated: evaluated.has(e.class.id) }));
  }

  async timetable(studentId: string) {
    return this.prisma.timetableEntry.findMany({
      where: { classId: { in: await this.activeClassIds(studentId) } },
      include: { class: { select: { id: true, name: true, room: true, meetingUrl: true, mode: true, teacher: { select: { name: true } } } } },
      orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    });
  }

  // ── Assignments ─────────────────────────────────────────────────────────────

  async assignments(studentId: string) {
    const rows = await this.prisma.assignment.findMany({
      where: { classId: { in: await this.classIds(studentId) }, published: true },
      include: { class: { select: { name: true } }, submissions: { where: { studentId } } },
      orderBy: [{ dueAt: "desc" }, { createdAt: "desc" }],
      take: 200,
    });
    return rows.map(({ submissions, ...a }) => ({ ...a, submission: submissions[0] ?? null }));
  }

  async submitAssignment(student: { sub: string; name: string }, assignmentId: string, dto: SubmitAssignmentDto) {
    const assignment = await this.prisma.assignment.findUnique({ where: { id: assignmentId }, include: { class: { select: { name: true, teacherId: true } } } });
    if (!assignment || !assignment.published || !(await this.activeClassIds(student.sub)).includes(assignment.classId)) throw new NotFoundException("Assignment not found.");
    if (!dto.content?.trim() && !dto.fileUrl) throw new BadRequestException("Write your answer or attach a file.");
    if (dto.fileUrl && !isSafeLink(dto.fileUrl)) throw new BadRequestException("Upload the file again.");
    const existing = await this.prisma.submission.findUnique({ where: { assignmentId_studentId: { assignmentId, studentId: student.sub } } });
    if (existing?.grade !== null && existing?.grade !== undefined) throw new ConflictException("This assignment has already been marked.");
    const row = await this.prisma.submission.upsert({
      where: { assignmentId_studentId: { assignmentId, studentId: student.sub } },
      create: { assignmentId, studentId: student.sub, content: dto.content?.trim() || null, fileUrl: dto.fileUrl || null },
      update: { content: dto.content?.trim() || null, fileUrl: dto.fileUrl || null, submittedAt: new Date() },
    });
    if (assignment.class.teacherId) {
      await this.notifications.notify("staff", [assignment.class.teacherId], { title: `${student.name} handed in “${assignment.title}”`, body: assignment.class.name, link: `/admin/teaching/${assignment.classId}` });
    }
    this.events.emit(["assignments", `class:${assignment.classId}`]);
    return { ...row, late: Boolean(assignment.dueAt && row.submittedAt > assignment.dueAt) };
  }

  // ── Exams ───────────────────────────────────────────────────────────────────

  async exams(studentId: string) {
    const exams = await this.prisma.exam.findMany({
      where: { classId: { in: await this.classIds(studentId) }, published: true },
      select: { id: true, title: true, description: true, opensAt: true, closesAt: true, durationMinutes: true, passMark: true, class: { select: { name: true } }, attempts: { where: { studentId } } },
      orderBy: [{ opensAt: "desc" }, { createdAt: "desc" }],
    });
    return exams.map(({ attempts, ...exam }) => {
      const attempt = attempts[0];
      return {
        ...exam,
        attempt: attempt
          ? { startedAt: attempt.startedAt, submittedAt: attempt.submittedAt, percentage: attempt.needsReview ? null : attempt.percentage, passed: attempt.passed, needsReview: attempt.needsReview, feedback: attempt.feedback }
          : null,
      };
    });
  }

  private async openExam(studentId: string, examId: string) {
    const exam = await this.prisma.exam.findUnique({ where: { id: examId } });
    if (!exam || !exam.published || !exam.classId || !(await this.activeClassIds(studentId)).includes(exam.classId)) throw new NotFoundException("Exam not found.");
    const now = Date.now();
    if (exam.opensAt && exam.opensAt.getTime() > now) throw new ForbiddenException("This exam hasn't opened yet.");
    if (exam.closesAt && exam.closesAt.getTime() + GRACE_MS < now) throw new ForbiddenException("This exam has closed.");
    return exam;
  }

  private deadline(exam: { durationMinutes: number; closesAt: Date | null }, startedAt: Date): Date {
    const byDuration = startedAt.getTime() + exam.durationMinutes * 60_000;
    return new Date(exam.closesAt ? Math.min(byDuration, exam.closesAt.getTime()) : byDuration);
  }

  /** Starts (or resumes) an attempt. The clock starts at the first opening and keeps running if the page is closed. */
  async startExam(studentId: string, examId: string) {
    const exam = await this.openExam(studentId, examId);
    let attempt = await this.prisma.examAttempt.findUnique({ where: { examId_studentId: { examId, studentId } } });
    if (attempt?.submittedAt) throw new ConflictException("You have already handed in this exam.");
    if (!attempt) {
      try {
        attempt = await this.prisma.examAttempt.create({ data: { examId, studentId, answers: { given: {}, marks: {} } } });
      } catch {
        attempt = await this.prisma.examAttempt.findUniqueOrThrow({ where: { examId_studentId: { examId, studentId } } });
      }
    }
    return {
      exam: { id: exam.id, title: exam.title, description: exam.description, durationMinutes: exam.durationMinutes },
      questions: studentPaper(exam.questions as unknown as Question[]),
      answers: attemptParts(attempt.answers).given,
      startedAt: attempt.startedAt,
      deadline: this.deadline(exam, attempt.startedAt),
    };
  }

  /** Saves answers as the student goes (so nothing is lost on a dropped connection), and hands in when `submit` is set. */
  async saveExam(studentId: string, examId: string, dto: ExamAnswersDto) {
    const exam = await this.openExam(studentId, examId);
    const attempt = await this.prisma.examAttempt.findUnique({ where: { examId_studentId: { examId, studentId } } });
    if (!attempt) throw new BadRequestException("Start the exam first.");
    if (attempt.submittedAt) throw new ConflictException("You have already handed in this exam.");
    const late = Date.now() > this.deadline(exam, attempt.startedAt).getTime() + GRACE_MS;
    const questions = exam.questions as unknown as Question[];
    const ids = new Set(questions.map((q) => q.id));
    const given = Object.fromEntries(Object.entries(dto.answers ?? {}).filter(([id]) => ids.has(id)).map(([id, value]) => [id, typeof value === "string" ? value.slice(0, 20_000) : value]));
    // After time is up, earlier saved answers stand and the attempt is handed in as it was.
    const answers = late ? attemptParts(attempt.answers).given : given;

    if (!dto.submit && !late) {
      await this.prisma.examAttempt.update({ where: { id: attempt.id }, data: { answers: { given: answers, marks: {} } as Prisma.InputJsonValue } });
      return { saved: true };
    }
    const result = grade(questions, answers, {}, exam.passMark);
    await this.prisma.examAttempt.update({
      where: { id: attempt.id },
      data: {
        answers: { given: answers, marks: {} } as Prisma.InputJsonValue,
        score: result.score,
        total: result.total,
        percentage: result.percentage,
        passed: result.passed,
        needsReview: result.needsReview,
        submittedAt: new Date(),
        gradedAt: result.needsReview ? null : new Date(),
      },
    });
    this.events.emit(["exams", `class:${exam.classId}`]);
    return { submitted: true, late, needsReview: result.needsReview, percentage: result.needsReview ? null : result.percentage, passed: result.passed };
  }

  // ── Results & attendance ────────────────────────────────────────────────────

  async results(studentId: string) {
    const [exams, assignments, skills, certificates] = await Promise.all([
      this.prisma.examAttempt.findMany({ where: { studentId, submittedAt: { not: null } }, select: { id: true, percentage: true, passed: true, needsReview: true, feedback: true, submittedAt: true, exam: { select: { title: true, class: { select: { name: true } } } } }, orderBy: { submittedAt: "desc" } }),
      this.prisma.submission.findMany({ where: { studentId, grade: { not: null } }, select: { id: true, grade: true, feedback: true, gradedAt: true, assignment: { select: { title: true, totalPoints: true, skill: true, class: { select: { name: true } } } } }, orderBy: { gradedAt: "desc" } }),
      this.prisma.skillAssessment.findMany({ where: { studentId }, orderBy: { createdAt: "desc" }, include: { assessedBy: { select: { name: true } } } }),
      this.certificates(studentId),
    ]);
    return { exams: exams.map((e) => ({ ...e, percentage: e.needsReview ? null : e.percentage })), assignments, skills, certificates };
  }

  async attendance(studentId: string) {
    const rows = await this.prisma.attendance.findMany({ where: { studentId }, include: { class: { select: { name: true } } }, orderBy: { date: "desc" }, take: 400 });
    const counts = { present: 0, late: 0, absent: 0, excused: 0 } as Record<string, number>;
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    const total = rows.length;
    return { records: rows, counts, rate: total ? Math.round(((counts.present + counts.late) / total) * 100) : null };
  }

  certificates(studentId: string) {
    return this.prisma.certificate.findMany({ where: { studentId, revoked: false }, orderBy: { issuedAt: "desc" } });
  }

  // ── Fees ────────────────────────────────────────────────────────────────────

  async fees(studentId: string) {
    const [invoices, payments, institution] = await Promise.all([
      this.prisma.invoice.findMany({ where: { studentId }, orderBy: { createdAt: "desc" } }),
      this.prisma.payment.findMany({ where: { studentId }, orderBy: { createdAt: "desc" } }),
      this.content.get("institution"),
    ]);
    const open = invoices.filter((i) => ["pending", "partial", "overdue"].includes(i.status));
    return {
      invoices: invoices.map((i) => ({ ...i, balance: balanceOf(i) })),
      payments,
      balance: open.reduce((sum, i) => sum + balanceOf(i), 0),
      currency: institution.currency,
      instructions: institution.paymentInstructions,
    };
  }

  async reportPayment(student: { sub: string; name: string }, dto: PaymentProofDto) {
    if (!isSafeLink(dto.proofUrl)) throw new BadRequestException("Upload the proof of payment again.");
    if (dto.invoiceId) {
      const invoice = await this.prisma.invoice.findUnique({ where: { id: dto.invoiceId }, select: { studentId: true } });
      if (!invoice || invoice.studentId !== student.sub) throw new BadRequestException("Choose one of your invoices.");
    }
    const pending = await this.prisma.payment.count({ where: { studentId: student.sub, status: "pending" } });
    if (pending >= 10) throw new BadRequestException("You have several payments waiting to be checked. Please wait for finance to confirm them.");
    const payment = await this.prisma.payment.create({
      data: { studentId: student.sub, invoiceId: dto.invoiceId ?? null, amount: dto.amount, method: dto.method, reference: dto.reference?.trim() || null, proofUrl: dto.proofUrl, note: dto.note?.trim() || null },
    });
    const finance = await this.notifications.staffWithAccess((s) => atLeast(effectiveAccess(s.role, s.department, s.permissions).finance, "edit"));
    await this.notifications.notify("staff", finance, { title: `Payment to check: ${student.name}`, body: `${dto.amount} via ${dto.method}`, link: "/admin/finance/payments" });
    await this.activity.log({ kind: "student", id: student.sub, name: student.name }, "reported", `${student.name} reported a payment of ${dto.amount}`, { type: "payments", id: payment.id });
    this.events.emit(["payments", `fees:${student.sub}`]);
    this.webhooks.dispatch("payments.reported", { id: payment.id, studentId: student.sub, amount: dto.amount, method: dto.method });
    return payment;
  }

  // ── Other ───────────────────────────────────────────────────────────────────

  async evaluate(studentId: string, classId: string, dto: EvaluationDto) {
    if (!(await this.classIds(studentId)).includes(classId)) throw new NotFoundException("Class not found.");
    try {
      return await this.prisma.courseEvaluation.create({ data: { studentId, classId, courseRating: dto.courseRating, teacherRating: dto.teacherRating, comments: dto.comments?.trim() || null } });
    } catch {
      throw new ConflictException("You've already sent feedback for this class. Thank you!");
    }
  }

  async scholarships(studentId: string) {
    const rows = await this.prisma.scholarship.findMany({
      where: { open: true },
      include: { applications: { where: { studentId }, select: { status: true, createdAt: true } } },
      orderBy: { deadline: "asc" },
    });
    return rows.map(({ applications, ...s }) => ({ ...s, application: applications[0] ?? null }));
  }

  async applyScholarship(studentId: string, scholarshipId: string, dto: ScholarshipApplyDto) {
    const scholarship = await this.prisma.scholarship.findUnique({ where: { id: scholarshipId } });
    if (!scholarship || !scholarship.open) throw new NotFoundException("This scholarship isn't open.");
    if (scholarship.deadline && scholarship.deadline < new Date(new Date().toISOString().slice(0, 10))) throw new BadRequestException("The deadline has passed.");
    try {
      const row = await this.prisma.scholarshipApplication.create({ data: { scholarshipId, studentId, statement: dto.statement.trim() } });
      this.events.emit(["scholarship-applications"]);
      return row;
    } catch {
      throw new ConflictException("You've already applied for this scholarship.");
    }
  }

  /** Members' library: everything published, including items for students only. */
  library(query: { q?: string; language?: string; level?: string }) {
    return this.prisma.libraryItem.findMany({
      where: {
        published: true,
        ...(query.language ? { language: query.language } : {}),
        ...(query.level ? { level: query.level } : {}),
        ...(query.q ? { OR: [{ title: { contains: query.q, mode: "insensitive" } }, { author: { contains: query.q, mode: "insensitive" } }] } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
  }

  apps() {
    return this.prisma.externalApp.findMany({ where: { active: true, audience: { in: ["all", "students"] } }, orderBy: { position: "asc" } });
  }

  async updateProfile(studentId: string, dto: ProfileDto) {
    if (dto.photoUrl && !isSafeLink(dto.photoUrl)) throw new BadRequestException("Upload the photo again.");
    const row = await this.prisma.student.update({
      where: { id: studentId },
      data: {
        ...(dto.phone !== undefined ? { phone: dto.phone.trim() || null } : {}),
        ...(dto.address !== undefined ? { address: dto.address.trim() || null } : {}),
        ...(dto.guardianName !== undefined ? { guardianName: dto.guardianName.trim() || null } : {}),
        ...(dto.guardianPhone !== undefined ? { guardianPhone: dto.guardianPhone.trim() || null } : {}),
        ...(dto.photoUrl !== undefined ? { photoUrl: dto.photoUrl || null } : {}),
      },
      select: { id: true, studentNo: true, name: true, email: true, phone: true, address: true, guardianName: true, guardianPhone: true, photoUrl: true, course: true, level: true, status: true, dateOfBirth: true },
    });
    this.events.emit(["students"]);
    return row;
  }

  profile(studentId: string) {
    return this.prisma.student.findUniqueOrThrow({
      where: { id: studentId },
      select: { id: true, studentNo: true, name: true, email: true, phone: true, address: true, guardianName: true, guardianPhone: true, photoUrl: true, course: true, level: true, status: true, dateOfBirth: true, createdAt: true },
    });
  }
}
