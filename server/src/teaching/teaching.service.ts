import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { EventsService } from "../events/events.service";
import { ActivityService } from "../activity/activity.service";
import { NotificationsService } from "../messaging/notifications.service";
import { atLeast, type AccessMap } from "../access/modules";
import { isSafeLink } from "../resources/validate";
import { grade, validateQuestions, type Question } from "../exams/grading";
import type { AssignmentDto, AttendanceDto, ExamDto, GradeSubmissionDto, MarkAttemptDto, SkillAssessmentDto } from "./teaching.dto";

export interface Teacher {
  sub: string;
  name: string;
  role: string;
  access: AccessMap;
}

const dateOnly = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00.000Z`);

/** Reads the teacher's own marks stored with an attempt ({ given, marks }). */
export function attemptParts(answers: unknown): { given: Record<string, unknown>; marks: Record<string, number> } {
  const value = (answers ?? {}) as { given?: Record<string, unknown>; marks?: Record<string, number> };
  return { given: value.given ?? {}, marks: value.marks ?? {} };
}

/**
 * A teacher's day: their classes, registers, assignments and marking, exams and gradebook.
 *
 * Teachers work on the classes they teach. Academic staff (Academics module) can open every
 * class — viewing with "view", changing with "edit" — so a coordinator can cover for someone.
 */
@Injectable()
export class TeachingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService
  ) {}

  private async classFor(teacher: Teacher, classId: string, write: boolean) {
    const cls = await this.prisma.classGroup.findUnique({ where: { id: classId }, include: { course: { select: { title: true } }, teacher: { select: { id: true, name: true } } } });
    if (!cls) throw new NotFoundException("Class not found.");
    const coordinator = teacher.role === "OWNER" || atLeast(teacher.access.academics, write ? "edit" : "view");
    if (cls.teacherId !== teacher.sub && !coordinator) throw new ForbiddenException("This isn't one of your classes.");
    if (write && cls.teacherId === teacher.sub && !atLeast(teacher.access.teaching, "edit") && !coordinator) throw new ForbiddenException("You can view this class but not change it.");
    return cls;
  }

  private async studentIds(classId: string): Promise<string[]> {
    const rows = await this.prisma.enrollment.findMany({ where: { classId, status: "active" }, select: { studentId: true } });
    return rows.map((r) => r.studentId);
  }

  async myClasses(teacher: Teacher, all: boolean) {
    const seeAll = all && (teacher.role === "OWNER" || atLeast(teacher.access.academics, "view"));
    const classes = await this.prisma.classGroup.findMany({
      where: { ...(seeAll ? {} : { teacherId: teacher.sub }), status: { in: ["planned", "active"] } },
      include: {
        course: { select: { title: true } },
        teacher: { select: { name: true } },
        timetable: { orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] },
        _count: { select: { enrollments: { where: { status: "active" } } } },
      },
      orderBy: { name: "asc" },
    });
    const toMark = await this.prisma.submission.groupBy({ by: ["assignmentId"], where: { grade: null, assignment: { classId: { in: classes.map((c) => c.id) } } }, _count: true });
    const assignmentClass = await this.prisma.assignment.findMany({ where: { id: { in: toMark.map((t) => t.assignmentId) } }, select: { id: true, classId: true } });
    const reviewAttempts = await this.prisma.examAttempt.findMany({ where: { needsReview: true, submittedAt: { not: null }, exam: { classId: { in: classes.map((c) => c.id) } } }, select: { exam: { select: { classId: true } } } });
    return classes.map((c) => ({
      ...c,
      students: c._count.enrollments,
      toMark:
        toMark.filter((t) => assignmentClass.find((a) => a.id === t.assignmentId)?.classId === c.id).reduce((sum, t) => sum + t._count, 0) +
        reviewAttempts.filter((a) => a.exam.classId === c.id).length,
    }));
  }

  /** Today's lessons for this teacher, for the dashboard. */
  async today(teacher: Teacher) {
    const day = new Date().getDay();
    return this.prisma.timetableEntry.findMany({
      where: { dayOfWeek: day, class: { teacherId: teacher.sub, status: "active" } },
      include: { class: { select: { id: true, name: true, room: true, meetingUrl: true, mode: true } } },
      orderBy: { startTime: "asc" },
    });
  }

  async roster(teacher: Teacher, classId: string) {
    const cls = await this.classFor(teacher, classId, false);
    const enrollments = await this.prisma.enrollment.findMany({
      where: { classId, status: { in: ["active", "waitlisted"] } },
      include: { student: { select: { id: true, name: true, studentNo: true, email: true, phone: true, photoUrl: true, level: true } } },
      orderBy: { student: { name: "asc" } },
    });
    const attendance = await this.prisma.attendance.groupBy({ by: ["studentId", "status"], where: { classId }, _count: true });
    const rate = (studentId: string) => {
      const rows = attendance.filter((a) => a.studentId === studentId);
      const total = rows.reduce((sum, r) => sum + r._count, 0);
      const present = rows.filter((r) => r.status === "present" || r.status === "late").reduce((sum, r) => sum + r._count, 0);
      return total ? Math.round((present / total) * 100) : null;
    };
    return { class: cls, students: enrollments.map((e) => ({ ...e.student, enrollment: e.status, attendanceRate: rate(e.student.id) })) };
  }

  // ── Attendance ──────────────────────────────────────────────────────────────

  async attendance(teacher: Teacher, classId: string, date: string) {
    await this.classFor(teacher, classId, false);
    return this.prisma.attendance.findMany({ where: { classId, date: dateOnly(date) }, select: { studentId: true, status: true, notes: true } });
  }

  async saveAttendance(teacher: Teacher, classId: string, dto: AttendanceDto) {
    const cls = await this.classFor(teacher, classId, true);
    const date = dateOnly(dto.date);
    if (date.getTime() > Date.now() + 86400_000) throw new BadRequestException("You can't take the register for a future date.");
    const allowed = new Set(await this.studentIds(classId));
    const entries = dto.entries.filter((e) => allowed.has(e.studentId));
    await this.prisma.$transaction(
      entries.map((entry) =>
        this.prisma.attendance.upsert({
          where: { classId_studentId_date: { classId, studentId: entry.studentId, date } },
          create: { classId, studentId: entry.studentId, date, status: entry.status, notes: entry.notes?.trim() || null },
          update: { status: entry.status, notes: entry.notes?.trim() || null },
        })
      )
    );
    const absent = entries.filter((e) => e.status === "absent").map((e) => e.studentId);
    if (absent.length && dto.notifyAbsent) {
      await this.notifications.notify("student", absent, { title: `Marked absent: ${cls.name}`, body: `You were marked absent on ${dto.date}. Tell your teacher if this is a mistake.`, link: "/portal/attendance" });
    }
    await this.activity.log({ kind: "staff", id: teacher.sub, name: teacher.name }, "attendance", `Took the register for ${cls.name} (${dto.date}): ${entries.length - absent.length} present, ${absent.length} absent`, { type: "classes", id: classId });
    this.events.emit(["attendance", ...entries.map((e) => `student:${e.studentId}`)]);
    return { saved: entries.length };
  }

  // ── Assignments ─────────────────────────────────────────────────────────────

  async assignments(teacher: Teacher, classId: string) {
    await this.classFor(teacher, classId, false);
    const [rows, students] = await Promise.all([
      this.prisma.assignment.findMany({ where: { classId }, orderBy: [{ dueAt: "desc" }, { createdAt: "desc" }], include: { _count: { select: { submissions: true } }, submissions: { where: { grade: null }, select: { id: true } } } }),
      this.studentIds(classId),
    ]);
    return rows.map(({ submissions, _count, ...a }) => ({ ...a, submitted: _count.submissions, toMark: submissions.length, students: students.length }));
  }

  private assignmentData(dto: AssignmentDto) {
    if (dto.attachmentUrl && !isSafeLink(dto.attachmentUrl)) throw new BadRequestException("Upload the attachment again.");
    return {
      title: dto.title.trim(),
      description: dto.description?.trim() || null,
      attachmentUrl: dto.attachmentUrl || null,
      skill: dto.skill || null,
      dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
      totalPoints: dto.totalPoints ?? 100,
      published: dto.published ?? true,
    };
  }

  async createAssignment(teacher: Teacher, classId: string, dto: AssignmentDto) {
    const cls = await this.classFor(teacher, classId, true);
    const row = await this.prisma.assignment.create({ data: { classId, ...this.assignmentData(dto) } });
    if (row.published) {
      await this.notifications.notify("student", await this.studentIds(classId), { title: `New assignment: ${row.title}`, body: `${cls.name}${row.dueAt ? ` · due ${row.dueAt.toISOString().slice(0, 10)}` : ""}`, link: "/portal/assignments" });
    }
    await this.activity.log({ kind: "staff", id: teacher.sub, name: teacher.name }, "created", `Set assignment “${row.title}” for ${cls.name}`, { type: "assignments", id: row.id }, { kind: "created", model: "assignment", id: row.id, topic: "assignments" });
    this.events.emit(["assignments", `class:${classId}`]);
    return row;
  }

  async updateAssignment(teacher: Teacher, id: string, dto: AssignmentDto) {
    const existing = await this.prisma.assignment.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Assignment not found.");
    await this.classFor(teacher, existing.classId, true);
    const row = await this.prisma.assignment.update({ where: { id }, data: this.assignmentData(dto) });
    this.events.emit(["assignments", `class:${existing.classId}`]);
    return row;
  }

  async deleteAssignment(teacher: Teacher, id: string) {
    const existing = await this.prisma.assignment.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Assignment not found.");
    await this.classFor(teacher, existing.classId, true);
    await this.prisma.assignment.delete({ where: { id } });
    await this.activity.log({ kind: "staff", id: teacher.sub, name: teacher.name }, "deleted", `Deleted assignment “${existing.title}”`, { type: "assignments", id });
    this.events.emit(["assignments", `class:${existing.classId}`]);
    return { deleted: true };
  }

  async submissions(teacher: Teacher, assignmentId: string) {
    const assignment = await this.prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) throw new NotFoundException("Assignment not found.");
    await this.classFor(teacher, assignment.classId, false);
    const [submissions, enrolled] = await Promise.all([
      this.prisma.submission.findMany({ where: { assignmentId }, include: { student: { select: { id: true, name: true, studentNo: true } } }, orderBy: { submittedAt: "asc" } }),
      this.prisma.enrollment.findMany({ where: { classId: assignment.classId, status: "active" }, include: { student: { select: { id: true, name: true, studentNo: true } } } }),
    ]);
    const submitted = new Set(submissions.map((s) => s.studentId));
    return { assignment, submissions, missing: enrolled.filter((e) => !submitted.has(e.studentId)).map((e) => e.student) };
  }

  async gradeSubmission(teacher: Teacher, id: string, dto: GradeSubmissionDto) {
    const submission = await this.prisma.submission.findUnique({ where: { id }, include: { assignment: true } });
    if (!submission) throw new NotFoundException("Submission not found.");
    await this.classFor(teacher, submission.assignment.classId, true);
    if (dto.grade > submission.assignment.totalPoints) throw new BadRequestException(`The most this assignment can score is ${submission.assignment.totalPoints}.`);
    const row = await this.prisma.submission.update({ where: { id }, data: { grade: dto.grade, feedback: dto.feedback?.trim() || null, gradedAt: new Date() } });
    await this.notifications.notify("student", [submission.studentId], { title: `Marked: ${submission.assignment.title}`, body: `${dto.grade} / ${submission.assignment.totalPoints}`, link: "/portal/assignments" });
    this.events.emit(["assignments", `student:${submission.studentId}`]);
    return row;
  }

  // ── Exams ───────────────────────────────────────────────────────────────────

  async exams(teacher: Teacher, classId: string) {
    await this.classFor(teacher, classId, false);
    const rows = await this.prisma.exam.findMany({
      where: { classId },
      orderBy: [{ opensAt: "desc" }, { createdAt: "desc" }],
      include: { _count: { select: { attempts: true } }, attempts: { where: { needsReview: true, submittedAt: { not: null } }, select: { id: true } } },
    });
    return rows.map(({ attempts, _count, ...exam }) => ({ ...exam, questionCount: Array.isArray(exam.questions) ? exam.questions.length : 0, attempts: _count.attempts, toMark: attempts.length }));
  }

  private examData(dto: ExamDto) {
    const { questions, problems } = validateQuestions(dto.questions ?? []);
    if (problems.length) throw new BadRequestException({ message: "Please fix the questions.", problems });
    if (dto.published && !questions.length) throw new BadRequestException("Add at least one question before opening the exam.");
    const opensAt = dto.opensAt ? new Date(dto.opensAt) : null;
    const closesAt = dto.closesAt ? new Date(dto.closesAt) : null;
    if (opensAt && closesAt && closesAt <= opensAt) throw new BadRequestException("The exam must close after it opens.");
    return {
      title: dto.title.trim(),
      description: dto.description?.trim() || null,
      opensAt,
      closesAt,
      durationMinutes: dto.durationMinutes ?? 60,
      passMark: dto.passMark ?? 50,
      published: dto.published ?? false,
      questions: questions as unknown as Prisma.InputJsonValue,
    };
  }

  async getExam(teacher: Teacher, id: string) {
    const exam = await this.prisma.exam.findUnique({ where: { id } });
    if (!exam || !exam.classId) throw new NotFoundException("Exam not found.");
    await this.classFor(teacher, exam.classId, false);
    return exam;
  }

  async createExam(teacher: Teacher, classId: string, dto: ExamDto) {
    const cls = await this.classFor(teacher, classId, true);
    const exam = await this.prisma.exam.create({ data: { classId, ...this.examData(dto) } });
    if (exam.published) await this.announceExam(classId, exam.title, cls.name);
    await this.activity.log({ kind: "staff", id: teacher.sub, name: teacher.name }, "created", `Created exam “${exam.title}” for ${cls.name}`, { type: "exams", id: exam.id }, { kind: "created", model: "exam", id: exam.id, topic: "exams" });
    this.events.emit(["exams", `class:${classId}`]);
    return exam;
  }

  async updateExam(teacher: Teacher, id: string, dto: ExamDto) {
    const existing = await this.getExam(teacher, id);
    const cls = await this.classFor(teacher, existing.classId!, true);
    const started = await this.prisma.examAttempt.count({ where: { examId: id } });
    const data = this.examData(dto);
    if (started && JSON.stringify(data.questions) !== JSON.stringify(existing.questions)) {
      throw new BadRequestException("Students have already started this exam, so its questions can't change. Duplicate it instead.");
    }
    const exam = await this.prisma.exam.update({ where: { id }, data });
    if (exam.published && !existing.published) await this.announceExam(existing.classId!, exam.title, cls.name);
    this.events.emit(["exams", `class:${existing.classId}`]);
    return exam;
  }

  private async announceExam(classId: string, title: string, className: string) {
    await this.notifications.notify("student", await this.studentIds(classId), { title: `Exam open: ${title}`, body: className, link: "/portal/exams" });
  }

  async attempts(teacher: Teacher, examId: string) {
    const exam = await this.getExam(teacher, examId);
    const attempts = await this.prisma.examAttempt.findMany({
      where: { examId },
      include: { student: { select: { id: true, name: true, studentNo: true } } },
      orderBy: { student: { name: "asc" } },
    });
    return { exam, attempts: attempts.map((a) => ({ ...a, ...attemptParts(a.answers) })) };
  }

  async markAttempt(teacher: Teacher, attemptId: string, dto: MarkAttemptDto) {
    const attempt = await this.prisma.examAttempt.findUnique({ where: { id: attemptId }, include: { exam: true } });
    if (!attempt || !attempt.exam.classId) throw new NotFoundException("Attempt not found.");
    await this.classFor(teacher, attempt.exam.classId, true);
    const { given, marks } = attemptParts(attempt.answers);
    const merged = { ...marks, ...(dto.marks ?? {}) };
    const result = grade(attempt.exam.questions as unknown as Question[], given, merged, attempt.exam.passMark);
    const updated = await this.prisma.examAttempt.update({
      where: { id: attemptId },
      data: {
        answers: { given, marks: merged } as Prisma.InputJsonValue,
        score: result.score,
        total: result.total,
        percentage: result.percentage,
        passed: result.passed,
        needsReview: result.needsReview,
        feedback: dto.feedback?.trim() ?? attempt.feedback,
        gradedAt: result.needsReview ? null : new Date(),
      },
    });
    if (!result.needsReview) {
      await this.notifications.notify("student", [attempt.studentId], { title: `Result ready: ${attempt.exam.title}`, body: `${result.percentage}%`, link: "/portal/results" });
    }
    this.events.emit(["exams", `student:${attempt.studentId}`]);
    return updated;
  }

  // ── Gradebook & skills ──────────────────────────────────────────────────────

  async gradebook(teacher: Teacher, classId: string) {
    const cls = await this.classFor(teacher, classId, false);
    const [enrollments, assignments, exams, attendance] = await Promise.all([
      this.prisma.enrollment.findMany({ where: { classId, status: "active" }, include: { student: { select: { id: true, name: true, studentNo: true } } }, orderBy: { student: { name: "asc" } } }),
      this.prisma.assignment.findMany({ where: { classId }, select: { id: true, title: true, totalPoints: true, submissions: { select: { studentId: true, grade: true } } }, orderBy: { createdAt: "asc" } }),
      this.prisma.exam.findMany({ where: { classId }, select: { id: true, title: true, attempts: { select: { studentId: true, percentage: true, needsReview: true } } }, orderBy: { createdAt: "asc" } }),
      this.prisma.attendance.groupBy({ by: ["studentId", "status"], where: { classId }, _count: true }),
    ]);
    const columns = [
      ...assignments.map((a) => ({ id: a.id, kind: "assignment" as const, title: a.title, outOf: a.totalPoints })),
      ...exams.map((e) => ({ id: e.id, kind: "exam" as const, title: e.title, outOf: 100 })),
    ];
    const rows = enrollments.map(({ student }) => {
      const scores: Record<string, number | null> = {};
      const percents: number[] = [];
      for (const a of assignments) {
        const g = a.submissions.find((s) => s.studentId === student.id)?.grade ?? null;
        scores[a.id] = g;
        if (g !== null) percents.push((g / a.totalPoints) * 100);
      }
      for (const e of exams) {
        const at = e.attempts.find((s) => s.studentId === student.id);
        const p = at && !at.needsReview ? at.percentage : null;
        scores[e.id] = p;
        if (p !== null && p !== undefined) percents.push(p);
      }
      const att = attendance.filter((r) => r.studentId === student.id);
      const total = att.reduce((s, r) => s + r._count, 0);
      const present = att.filter((r) => r.status === "present" || r.status === "late").reduce((s, r) => s + r._count, 0);
      return {
        student,
        scores,
        average: percents.length ? Math.round((percents.reduce((s, p) => s + p, 0) / percents.length) * 10) / 10 : null,
        attendanceRate: total ? Math.round((present / total) * 100) : null,
      };
    });
    return { class: cls, columns, rows };
  }

  async addSkillAssessment(teacher: Teacher, classId: string, dto: SkillAssessmentDto) {
    await this.classFor(teacher, classId, true);
    if (!(await this.studentIds(classId)).includes(dto.studentId)) throw new BadRequestException("That student isn't in this class.");
    const row = await this.prisma.skillAssessment.create({
      data: {
        studentId: dto.studentId,
        classId,
        term: dto.term?.trim() || null,
        reading: dto.reading ?? null,
        writing: dto.writing ?? null,
        listening: dto.listening ?? null,
        speaking: dto.speaking ?? null,
        cefrLevel: dto.cefrLevel ?? null,
        comments: dto.comments?.trim() || null,
        assessedById: teacher.sub,
      },
    });
    await this.notifications.notify("student", [dto.studentId], { title: "New skills report", body: dto.cefrLevel ? `Level reached: ${dto.cefrLevel}` : undefined, link: "/portal/results" });
    this.events.emit(["skill-assessments", `student:${dto.studentId}`]);
    return row;
  }

  /** A short notice to everyone in a class (bell + optional email). */
  async notifyClass(teacher: Teacher, classId: string, title: string, body: string, email: boolean) {
    const cls = await this.classFor(teacher, classId, true);
    const ids = await this.studentIds(classId);
    await this.notifications.notify("student", ids, { title: `${cls.name}: ${title}`, body, link: "/portal/classes", email });
    await this.activity.log({ kind: "staff", id: teacher.sub, name: teacher.name }, "notified", `Sent “${title}” to ${cls.name} (${ids.length} students)`, { type: "classes", id: classId });
    return { sent: ids.length };
  }
}
