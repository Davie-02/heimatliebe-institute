import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EventsService } from "../events/events.service";
import { EmailService } from "../email/email.service";
import { StorageService } from "../uploads/storage.service";
import { SiteContentService } from "../site/site-content.service";
import { atLeast, type AccessMap } from "../access/modules";
import { GeminiClient } from "../assistant/gemini.client";

const startedAt = new Date();
const today = () => new Date(new Date().toISOString().slice(0, 10));

export interface Viewer {
  sub: string;
  role: string;
  access: AccessMap;
}

/** The staff home page (what needs attention, by area), the search box and system status. */
@Injectable()
export class WorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly email: EmailService,
    private readonly storage: StorageService,
    private readonly content: SiteContentService,
    private readonly gemini: GeminiClient
  ) {}

  private can(viewer: Viewer, module: keyof AccessMap, level: "view" | "edit" = "view") {
    return viewer.role === "OWNER" || atLeast(viewer.access[module], level);
  }

  async overview(viewer: Viewer) {
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const tasks: Array<Promise<[string, unknown]>> = [];
    const add = (key: string, work: () => Promise<unknown>) => tasks.push(work().then((value) => [key, value] as [string, unknown]));

    if (this.can(viewer, "admissions")) {
      add("admissions", async () => {
        const [pending, newEnquiries, followUps, examRegistrations, recent] = await Promise.all([
          this.prisma.application.count({ where: { status: { in: ["pending", "reviewing"] } } }),
          this.prisma.enquiry.count({ where: { status: "new" } }),
          this.prisma.enquiry.findMany({
            where: { status: { in: ["new", "contacted", "follow_up"] }, nextFollowUp: { lte: today() } },
            select: { id: true, name: true, phone: true, interest: true, nextFollowUp: true },
            orderBy: { nextFollowUp: "asc" },
            take: 6,
          }),
          this.prisma.examRegistration.count({ where: { status: "pending" } }),
          this.prisma.application.findMany({ where: { status: "pending" }, select: { id: true, name: true, course: true, level: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 6 }),
        ]);
        return { pending, newEnquiries, followUps, examRegistrations, recent };
      });
    }
    if (this.can(viewer, "students")) {
      add("students", async () => {
        const [active, newThisMonth, byLevel] = await Promise.all([
          this.prisma.student.count({ where: { status: "active" } }),
          this.prisma.student.count({ where: { createdAt: { gte: monthStart } } }),
          this.prisma.student.groupBy({ by: ["level"], where: { status: "active" }, _count: true }),
        ]);
        return { active, newThisMonth, byLevel: byLevel.map((l) => ({ level: l.level ?? "—", count: l._count })) };
      });
    }
    if (this.can(viewer, "finance")) {
      add("finance", async () => {
        const [pendingPayments, overdue, month] = await Promise.all([
          this.prisma.payment.count({ where: { status: "pending" } }),
          this.prisma.invoice.count({ where: { status: "overdue" } }),
          this.prisma.payment.aggregate({ where: { status: "confirmed", confirmedAt: { gte: monthStart } }, _sum: { amount: true } }),
        ]);
        return { pendingPayments, overdue, collectedThisMonth: Number(month._sum.amount ?? 0), currency: (await this.content.get("institution")).currency };
      });
    }
    if (this.can(viewer, "teaching") || this.can(viewer, "academics")) {
      add("teaching", async () => {
        const day = new Date().getDay();
        const [lessons, toMark, review] = await Promise.all([
          this.prisma.timetableEntry.findMany({
            where: { dayOfWeek: day, class: { teacherId: viewer.sub, status: "active" } },
            include: { class: { select: { id: true, name: true, room: true, meetingUrl: true } } },
            orderBy: { startTime: "asc" },
          }),
          this.prisma.submission.count({ where: { grade: null, assignment: { class: { teacherId: viewer.sub } } } }),
          this.prisma.examAttempt.count({ where: { needsReview: true, submittedAt: { not: null }, exam: { class: { teacherId: viewer.sub } } } }),
        ]);
        return { lessons, toMark: toMark + review };
      });
    }
    if (this.can(viewer, "academics")) {
      add("academics", async () => {
        const [activeClasses, upcomingSessions, events] = await Promise.all([
          this.prisma.classGroup.count({ where: { status: "active" } }),
          this.prisma.examSession.count({ where: { examDate: { gte: today() } } }),
          this.prisma.calendarEvent.findMany({ where: { startDate: { gte: today() } }, orderBy: { startDate: "asc" }, take: 5 }),
        ]);
        return { activeClasses, upcomingSessions, events };
      });
    }
    if (this.can(viewer, "hr")) {
      add("hr", async () => {
        const [pendingLeave, away] = await Promise.all([
          this.prisma.leaveRequest.count({ where: { status: "pending" } }),
          this.prisma.leaveRequest.findMany({ where: { status: "approved", startDate: { lte: today() }, endDate: { gte: today() } }, include: { staff: { select: { name: true } } } }),
        ]);
        return { pendingLeave, away: away.map((a) => ({ name: a.staff.name, until: a.endDate, type: a.type })) };
      });
    }
    if (this.can(viewer, "assistant")) {
      add("assistant", async () => ({ drafts: await this.prisma.faqSuggestion.count({ where: { status: "draft" } }) }));
    }
    const [announcements] = await Promise.all([
      this.prisma.announcement.findMany({
        where: { published: true, audience: { in: ["all", "staff"] }, OR: [{ expiresAt: null }, { expiresAt: { gte: today() } }] },
        orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
        take: 4,
      }),
    ]);
    const entries = await Promise.all(tasks);
    return { ...Object.fromEntries(entries), announcements };
  }

  /** One search box across the records this person may see. */
  async search(viewer: Viewer, q: string) {
    const text = q.trim().slice(0, 80);
    if (text.length < 2) return [];
    const contains = { contains: text, mode: "insensitive" as const };
    const results: Array<{ kind: string; id: string; title: string; detail?: string; link: string }> = [];
    const jobs: Array<Promise<void>> = [];

    if (this.can(viewer, "students")) {
      jobs.push(
        this.prisma.student
          .findMany({ where: { OR: [{ name: contains }, { email: contains }, { studentNo: contains }, { phone: contains }] }, select: { id: true, name: true, studentNo: true }, take: 6 })
          .then((rows) => void results.push(...rows.map((r) => ({ kind: "Student", id: r.id, title: r.name, detail: r.studentNo, link: `/admin/students/${r.id}` }))))
      );
    }
    if (this.can(viewer, "admissions")) {
      jobs.push(
        this.prisma.application
          .findMany({ where: { OR: [{ name: contains }, { email: contains }, { reference: contains }] }, select: { id: true, name: true, reference: true, status: true }, take: 5 })
          .then((rows) => void results.push(...rows.map((r) => ({ kind: "Application", id: r.id, title: r.name, detail: `${r.reference} · ${r.status}`, link: `/admin/r/applications/${r.id}` }))))
      );
      jobs.push(
        this.prisma.enquiry
          .findMany({ where: { OR: [{ name: contains }, { email: contains }, { phone: contains }] }, select: { id: true, name: true, status: true }, take: 5 })
          .then((rows) => void results.push(...rows.map((r) => ({ kind: "Enquiry", id: r.id, title: r.name, detail: r.status, link: `/admin/r/enquiries/${r.id}` }))))
      );
    }
    if (this.can(viewer, "finance")) {
      jobs.push(
        this.prisma.invoice
          .findMany({ where: { invoiceNo: contains }, select: { id: true, invoiceNo: true, description: true }, take: 5 })
          .then((rows) => void results.push(...rows.map((r) => ({ kind: "Invoice", id: r.id, title: r.invoiceNo, detail: r.description, link: `/admin/r/invoices/${r.id}` }))))
      );
    }
    if (this.can(viewer, "academics")) {
      jobs.push(
        this.prisma.classGroup
          .findMany({ where: { name: contains }, select: { id: true, name: true, level: true }, take: 5 })
          .then((rows) => void results.push(...rows.map((r) => ({ kind: "Class", id: r.id, title: r.name, detail: r.level ?? undefined, link: `/admin/r/classes/${r.id}` }))))
      );
    }
    jobs.push(
      this.prisma.staff
        .findMany({ where: { isActive: true, OR: [{ name: contains }, { email: contains }] }, select: { id: true, name: true, jobTitle: true }, take: 5 })
        .then((rows) => void results.push(...rows.map((r) => ({ kind: "Colleague", id: r.id, title: r.name, detail: r.jobTitle ?? undefined, link: `/admin/directory` }))))
    );
    await Promise.all(jobs);
    return results;
  }

  async systemStatus() {
    let database = "ok";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = "unreachable";
    }
    return {
      database,
      email: { provider: this.email.provider, from: this.email.fromAddress, officeInbox: this.email.officeInbox ?? null },
      storage: this.storage.mode,
      assistant: this.gemini.configured,
      signIn: { google: Boolean(process.env.GOOGLE_CLIENT_ID), facebook: Boolean(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) },
      scheduler: process.env.RUN_SCHEDULER !== "false",
      liveConnections: this.events.clientCount,
      environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "development",
      startedAt,
      version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null,
    };
  }
}
