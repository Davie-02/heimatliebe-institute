import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

const monthKey = (d: Date) => d.toISOString().slice(0, 7);

function lastMonths(count: number): string[] {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1 - i), 1))));
}

function byMonth(dates: Date[], months: string[]) {
  const counts = new Map(months.map((m) => [m, 0]));
  for (const d of dates) {
    const key = monthKey(d);
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return months.map((month) => ({ month, count: counts.get(month) ?? 0 }));
}

/** The numbers the director and management watch, over the last twelve months. */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const months = lastMonths(12);
    const since = new Date(`${months[0]}-01T00:00:00.000Z`);
    const [
      students, applications, applicationStatus, enquiryChannels, enquiryStatus, placement, courseEnrollments, attendance, examAverages, levels, payments,
    ] = await Promise.all([
      this.prisma.student.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
      this.prisma.application.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
      this.prisma.application.groupBy({ by: ["status"], _count: true }),
      this.prisma.enquiry.groupBy({ by: ["channel"], where: { createdAt: { gte: since } }, _count: true }),
      this.prisma.enquiry.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: true }),
      this.prisma.placementAttempt.groupBy({ by: ["recommendedLevel"], where: { createdAt: { gte: since } }, _count: true }),
      this.prisma.enrollment.findMany({ where: { status: "active" }, select: { class: { select: { course: { select: { title: true } } } } } }),
      this.prisma.attendance.groupBy({ by: ["status"], where: { date: { gte: since } }, _count: true }),
      this.prisma.examAttempt.findMany({ where: { submittedAt: { gte: since }, needsReview: false, percentage: { not: null } }, select: { percentage: true, passed: true, exam: { select: { class: { select: { name: true } } } } } }),
      this.prisma.student.groupBy({ by: ["level"], where: { status: "active" }, _count: true }),
      this.prisma.payment.findMany({ where: { status: "confirmed", confirmedAt: { gte: since } }, select: { amount: true, confirmedAt: true } }),
    ]);

    const applied = applicationStatus.reduce((s, r) => s + r._count, 0);
    const accepted = applicationStatus.find((r) => r.status === "accepted")?._count ?? 0;
    const attendanceTotal = attendance.reduce((s, r) => s + r._count, 0);
    const attended = attendance.filter((r) => r.status === "present" || r.status === "late").reduce((s, r) => s + r._count, 0);

    const courseCounts = new Map<string, number>();
    for (const e of courseEnrollments) {
      const title = e.class.course?.title ?? "No course";
      courseCounts.set(title, (courseCounts.get(title) ?? 0) + 1);
    }
    const classScores = new Map<string, { sum: number; n: number; passed: number }>();
    for (const a of examAverages) {
      const name = a.exam.class?.name ?? "Other";
      const entry = classScores.get(name) ?? { sum: 0, n: 0, passed: 0 };
      entry.sum += a.percentage ?? 0;
      entry.n++;
      if (a.passed) entry.passed++;
      classScores.set(name, entry);
    }
    const revenue = new Map(months.map((m) => [m, 0]));
    for (const p of payments) {
      const key = monthKey(p.confirmedAt!);
      if (revenue.has(key)) revenue.set(key, (revenue.get(key) ?? 0) + Number(p.amount));
    }

    return {
      newStudents: byMonth(students.map((s) => s.createdAt), months),
      applications: byMonth(applications.map((a) => a.createdAt), months),
      revenue: months.map((month) => ({ month, amount: revenue.get(month) ?? 0 })),
      applicationStatus: applicationStatus.map((r) => ({ label: r.status, count: r._count })),
      conversionRate: applied ? Math.round((accepted / applied) * 100) : null,
      enquiryChannels: enquiryChannels.map((r) => ({ label: r.channel, count: r._count })),
      enquiryStatus: enquiryStatus.map((r) => ({ label: r.status, count: r._count })),
      placementLevels: placement.map((r) => ({ label: r.recommendedLevel, count: r._count })).sort((a, b) => a.label.localeCompare(b.label)),
      studentLevels: levels.map((r) => ({ label: r.level ?? "—", count: r._count })).sort((a, b) => a.label.localeCompare(b.label)),
      courses: [...courseCounts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
      attendanceRate: attendanceTotal ? Math.round((attended / attendanceTotal) * 100) : null,
      examResults: [...classScores.entries()].map(([label, v]) => ({ label, average: Math.round((v.sum / v.n) * 10) / 10, passRate: Math.round((v.passed / v.n) * 100), attempts: v.n })),
    };
  }
}
