import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "../email/email.service";
import { EventsService } from "../events/events.service";
import { ActivityService, type Actor } from "../activity/activity.service";
import { WebhooksService } from "../integrations/webhooks.service";
import { NotificationsService } from "../messaging/notifications.service";
import { SiteContentService } from "../site/site-content.service";
import { frontendUrl } from "../auth/auth.service";
import { invoiceNumber, receiptNumber } from "../common/codes";
import { feeReminderEmail, paymentConfirmedEmail } from "../email/templates";
import { balanceOf, invoiceStatus } from "./invoice-status";
import type { BulkInvoiceDto, RecordPaymentDto } from "./finance.dto";

const today = () => new Date(new Date().toISOString().slice(0, 10));
const money = (currency: string, amount: number) => `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/**
 * Fees and money: raising invoices (one by one or for a whole class), confirming payments that
 * students report or the office receives, receipts, statements, reminders and the numbers the
 * director watches. Every confirmed payment updates its invoice inside one database transaction,
 * so two cashiers confirming at the same moment can't double-count.
 */
@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly events: EventsService,
    private readonly activity: ActivityService,
    private readonly webhooks: WebhooksService,
    private readonly notifications: NotificationsService,
    private readonly content: SiteContentService
  ) {}

  private async currency() {
    return (await this.content.get("institution")).currency;
  }

  /** Applies a confirmed payment to its invoice (or the student's oldest unpaid invoice) and issues a receipt number. */
  async confirmPayment(id: string, actor: Actor & { id: string; name: string }) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const payment = await tx.payment.findUnique({ where: { id } });
        if (!payment) throw new NotFoundException("Payment not found.");
        if (payment.status !== "pending") throw new BadRequestException(`This payment is already ${payment.status}.`);

        let invoiceId = payment.invoiceId;
        if (!invoiceId) {
          const oldest = await tx.invoice.findFirst({ where: { studentId: payment.studentId, status: { in: ["pending", "partial", "overdue"] } }, orderBy: { createdAt: "asc" } });
          invoiceId = oldest?.id ?? null;
        }
        const receiptNo = receiptNumber();
        const confirmed = await tx.payment.update({
          where: { id },
          data: { status: "confirmed", receiptNo, confirmedAt: new Date(), confirmedBy: actor.name, invoiceId },
          include: { student: { select: { id: true, name: true, email: true } } },
        });
        if (invoiceId) {
          const invoice = await tx.invoice.update({ where: { id: invoiceId }, data: { paid: { increment: payment.amount } } });
          await tx.invoice.update({
            where: { id: invoiceId },
            data: { status: invoiceStatus({ amount: Number(invoice.amount), discount: Number(invoice.discount), paid: Number(invoice.paid), dueDate: invoice.dueDate, status: invoice.status }) },
          });
        }
        return confirmed;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    const currency = await this.currency();
    const amount = money(currency, Number(result.amount));
    void this.email.send({ to: result.student.email, ...paymentConfirmedEmail({ name: result.student.name, amount, receiptNo: result.receiptNo!, url: `${frontendUrl()}/portal/fees` }) });
    await this.notifications.notify("student", [result.studentId], { title: `Payment of ${amount} confirmed`, body: `Receipt ${result.receiptNo}`, link: "/portal/fees" });
    await this.activity.log(actor, "confirmed", `Confirmed ${amount} from ${result.student.name} (receipt ${result.receiptNo})`, { type: "payments", id });
    this.events.emit(["payments", "invoices", `fees:${result.studentId}`]);
    this.events.noteWrite();
    this.webhooks.dispatch("payments.confirmed", { id, receiptNo: result.receiptNo, studentId: result.studentId, amount: Number(result.amount), method: result.method });
    return result;
  }

  async rejectPayment(id: string, reason: string | undefined, actor: Actor & { id: string; name: string }) {
    const payment = await this.prisma.payment.findUnique({ where: { id }, include: { student: { select: { name: true } } } });
    if (!payment) throw new NotFoundException("Payment not found.");
    if (payment.status !== "pending") throw new BadRequestException(`This payment is already ${payment.status}.`);
    const updated = await this.prisma.payment.update({ where: { id }, data: { status: "rejected", note: reason ? `${payment.note ? `${payment.note}\n` : ""}Not accepted: ${reason}` : payment.note } });
    await this.notifications.notify("student", [payment.studentId], {
      title: "We couldn't confirm your payment",
      body: reason ?? "Please contact the finance office.",
      link: "/portal/fees",
      email: true,
    });
    await this.activity.log(actor, "rejected", `Did not accept a payment from ${payment.student.name}`, { type: "payments", id });
    this.events.emit(["payments", `fees:${payment.studentId}`]);
    return updated;
  }

  /** Money received at the office: recorded and confirmed in one step. */
  async recordPayment(dto: RecordPaymentDto, actor: Actor & { id: string; name: string }) {
    const student = await this.prisma.student.findUnique({ where: { id: dto.studentId }, select: { id: true } });
    if (!student) throw new BadRequestException("Choose a student.");
    if (dto.invoiceId) {
      const invoice = await this.prisma.invoice.findUnique({ where: { id: dto.invoiceId }, select: { studentId: true } });
      if (!invoice || invoice.studentId !== dto.studentId) throw new BadRequestException("That invoice belongs to a different student.");
    }
    const payment = await this.prisma.payment.create({
      data: { studentId: dto.studentId, invoiceId: dto.invoiceId ?? null, amount: dto.amount, method: dto.method, reference: dto.reference?.trim() || null, note: dto.note?.trim() || null },
    });
    return this.confirmPayment(payment.id, actor);
  }

  /** Invoices every active student in a class (or every listed student) for the same item. */
  async bulkInvoice(dto: BulkInvoiceDto, actor: Actor & { id: string; name: string }) {
    let studentIds = dto.studentIds ?? [];
    if (dto.classId) {
      const enrolled = await this.prisma.enrollment.findMany({ where: { classId: dto.classId, status: "active" }, select: { studentId: true } });
      studentIds = [...studentIds, ...enrolled.map((e) => e.studentId)];
    }
    studentIds = [...new Set(studentIds)];
    if (!studentIds.length) throw new BadRequestException("There are no students to invoice. Choose a class with active students, or pick students.");
    if (studentIds.length > 2000) throw new BadRequestException("Invoice at most 2,000 students at a time.");

    const dueDate = dto.dueDate ? new Date(`${dto.dueDate.slice(0, 10)}T00:00:00.000Z`) : null;
    let skipped = 0;
    if (dto.skipDuplicates !== false) {
      const already = await this.prisma.invoice.findMany({ where: { studentId: { in: studentIds }, description: dto.description, status: { not: "cancelled" } }, select: { studentId: true } });
      const has = new Set(already.map((i) => i.studentId));
      skipped = studentIds.filter((id) => has.has(id)).length;
      studentIds = studentIds.filter((id) => !has.has(id));
    }
    const created = await this.prisma.invoice.createMany({
      data: studentIds.map((studentId) => ({ invoiceNo: invoiceNumber(), studentId, description: dto.description, amount: dto.amount, discount: 0, dueDate })),
    });
    await this.notifications.notify("student", studentIds, { title: "New invoice", body: `${dto.description}: ${money(await this.currency(), dto.amount)}`, link: "/portal/fees" });
    await this.activity.log(actor, "invoiced", `Invoiced ${created.count} student(s) for “${dto.description}”`, { type: "invoices" });
    this.events.emit(["invoices", ...studentIds.map((id) => `fees:${id}`)]);
    this.events.noteWrite();
    return { created: created.count, skipped };
  }

  async statement(studentId: string) {
    const student = await this.prisma.student.findUnique({ where: { id: studentId }, select: { id: true, name: true, studentNo: true, email: true, phone: true, course: true, level: true } });
    if (!student) throw new NotFoundException("Student not found.");
    const [invoices, payments] = await Promise.all([
      this.prisma.invoice.findMany({ where: { studentId }, orderBy: { createdAt: "asc" } }),
      this.prisma.payment.findMany({ where: { studentId }, orderBy: { createdAt: "asc" } }),
    ]);
    const billed = invoices.filter((i) => i.status !== "cancelled").reduce((sum, i) => sum + Number(i.amount) - Number(i.discount), 0);
    const paid = payments.filter((p) => p.status === "confirmed").reduce((sum, p) => sum + Number(p.amount), 0);
    return { student, invoices, payments, totals: { billed, paid, balance: Math.round((billed - paid) * 100) / 100 }, currency: await this.currency(), generatedAt: new Date() };
  }

  async receipt(paymentId: string, studentId?: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { student: { select: { name: true, studentNo: true } }, invoice: { select: { invoiceNo: true, description: true, amount: true, discount: true, paid: true } } },
    });
    if (!payment || payment.status !== "confirmed" || (studentId && payment.studentId !== studentId)) throw new NotFoundException("Receipt not found.");
    return { payment, balance: payment.invoice ? balanceOf(payment.invoice) : null, currency: await this.currency(), institution: await this.content.get("institution") };
  }

  async summary() {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
    const [billed, collected, month, pending, overdue, recent] = await Promise.all([
      this.prisma.invoice.aggregate({ where: { status: { not: "cancelled" } }, _sum: { amount: true, discount: true } }),
      this.prisma.payment.aggregate({ where: { status: "confirmed" }, _sum: { amount: true } }),
      this.prisma.payment.aggregate({ where: { status: "confirmed", confirmedAt: { gte: monthStart } }, _sum: { amount: true } }),
      this.prisma.payment.count({ where: { status: "pending" } }),
      this.prisma.invoice.count({ where: { status: "overdue" } }),
      this.prisma.payment.findMany({ where: { status: "confirmed", confirmedAt: { gte: sixMonthsAgo } }, select: { amount: true, confirmedAt: true } }),
    ]);
    const byMonth = new Map<string, number>();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      byMonth.set(d.toISOString().slice(0, 7), 0);
    }
    for (const p of recent) {
      const key = p.confirmedAt!.toISOString().slice(0, 7);
      if (byMonth.has(key)) byMonth.set(key, (byMonth.get(key) ?? 0) + Number(p.amount));
    }
    const totalBilled = Number(billed._sum.amount ?? 0) - Number(billed._sum.discount ?? 0);
    const totalCollected = Number(collected._sum.amount ?? 0);
    return {
      currency: await this.currency(),
      billed: totalBilled,
      collected: totalCollected,
      outstanding: Math.max(0, Math.round((totalBilled - totalCollected) * 100) / 100),
      collectedThisMonth: Number(month._sum.amount ?? 0),
      pendingPayments: pending,
      overdueInvoices: overdue,
      monthly: [...byMonth.entries()].map(([month, amount]) => ({ month, amount })),
    };
  }

  /** Students with the largest unpaid balances. */
  async debtors(limit = 50) {
    const rows = await this.prisma.invoice.groupBy({
      by: ["studentId"],
      where: { status: { in: ["pending", "partial", "overdue"] } },
      _sum: { amount: true, discount: true, paid: true },
    });
    const balances = rows
      .map((r) => ({ studentId: r.studentId, balance: Number(r._sum.amount ?? 0) - Number(r._sum.discount ?? 0) - Number(r._sum.paid ?? 0) }))
      .filter((r) => r.balance > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, limit);
    const students = await this.prisma.student.findMany({ where: { id: { in: balances.map((b) => b.studentId) } }, select: { id: true, name: true, studentNo: true, phone: true } });
    const byId = new Map(students.map((s) => [s.id, s]));
    return balances.map((b) => ({ ...b, student: byId.get(b.studentId) }));
  }

  /** Every morning: mark late invoices overdue. */
  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async markOverdue(): Promise<number> {
    if (process.env.RUN_SCHEDULER === "false") return 0;
    const result = await this.prisma.invoice.updateMany({ where: { status: "pending", dueDate: { lt: today() } }, data: { status: "overdue" } });
    if (result.count) this.events.emit(["invoices"]);
    return result.count;
  }

  /** Every Monday: a friendly reminder for invoices due within 3 days or overdue (at most one a week each). */
  @Cron("0 8 * * 1")
  async sendReminders(): Promise<number> {
    if (process.env.RUN_SCHEDULER === "false") return 0;
    const soon = new Date(today().getTime() + 3 * 86400_000);
    const weekAgo = new Date(Date.now() - 6 * 86400_000);
    const invoices = await this.prisma.invoice.findMany({
      where: { status: { in: ["pending", "partial", "overdue"] }, dueDate: { lte: soon }, OR: [{ reminderSentAt: null }, { reminderSentAt: { lt: weekAgo } }] },
      include: { student: { select: { name: true, email: true, isActive: true } } },
      take: 500,
    });
    const currency = await this.currency();
    let sent = 0;
    for (const invoice of invoices) {
      if (!invoice.student.isActive) continue;
      const balance = balanceOf(invoice);
      if (balance <= 0) continue;
      const result = await this.email.sendChecked({
        to: invoice.student.email,
        ...feeReminderEmail({ name: invoice.student.name, invoiceNo: invoice.invoiceNo, balance: money(currency, balance), dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? "now", url: `${frontendUrl()}/portal/fees` }),
      });
      if (result.ok) {
        sent++;
        await this.prisma.invoice.update({ where: { id: invoice.id }, data: { reminderSentAt: new Date() } });
      }
    }
    if (sent) this.logger.log(`Sent ${sent} fee reminder(s).`);
    return sent;
  }
}
