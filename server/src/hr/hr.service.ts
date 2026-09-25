import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EventsService } from "../events/events.service";
import { ActivityService } from "../activity/activity.service";
import { NotificationsService } from "../messaging/notifications.service";
import { atLeast, effectiveAccess } from "../access/modules";
import { workingDays } from "./leave-days";
import type { LeaveDecisionDto, LeaveRequestDto } from "./hr.dto";

const day = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00.000Z`);

/** Leave requests: staff ask, HR decides, everyone is told. */
@Injectable()
export class HrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService
  ) {}

  myLeave(staffId: string) {
    return this.prisma.leaveRequest.findMany({ where: { staffId }, orderBy: { startDate: "desc" }, take: 100 });
  }

  async request(staff: { sub: string; name: string }, dto: LeaveRequestDto) {
    const start = day(dto.startDate);
    const end = day(dto.endDate);
    if (end < start) throw new BadRequestException("The last day can't be before the first.");
    const days = workingDays(start, end);
    if (days === 0) throw new BadRequestException("Those dates don't include any working days.");
    const overlap = await this.prisma.leaveRequest.findFirst({
      where: { staffId: staff.sub, status: { in: ["pending", "approved"] }, startDate: { lte: end }, endDate: { gte: start } },
    });
    if (overlap) throw new BadRequestException("You already have leave booked or requested for some of those days.");
    const row = await this.prisma.leaveRequest.create({ data: { staffId: staff.sub, type: dto.type, startDate: start, endDate: end, days, reason: dto.reason?.trim() || null } });
    await this.activity.log({ kind: "staff", id: staff.sub, name: staff.name }, "requested", `Requested ${days} day(s) of ${dto.type} leave`, { type: "leave-requests", id: row.id });
    const hr = await this.notifications.staffWithAccess((s) => atLeast(effectiveAccess(s.role, s.department, s.permissions).hr, "edit"));
    await this.notifications.notify("staff", hr.filter((id) => id !== staff.sub), { title: `Leave request from ${staff.name}`, body: `${days} working day(s) of ${dto.type} leave`, link: "/admin/leave" });
    this.events.emit(["leave-requests"]);
    return row;
  }

  async cancel(staffId: string, id: string) {
    const row = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!row || row.staffId !== staffId) throw new NotFoundException("Leave request not found.");
    if (row.status !== "pending") throw new BadRequestException("Only pending requests can be withdrawn. Ask HR to change a decided one.");
    await this.prisma.leaveRequest.update({ where: { id }, data: { status: "cancelled" } });
    this.events.emit(["leave-requests"]);
    return { cancelled: true };
  }

  async decide(reviewer: { sub: string; name: string }, id: string, dto: LeaveDecisionDto) {
    const row = await this.prisma.leaveRequest.findUnique({ where: { id }, include: { staff: { select: { name: true } } } });
    if (!row) throw new NotFoundException("Leave request not found.");
    if (row.staffId === reviewer.sub) throw new ForbiddenException("Someone else has to decide your own leave.");
    if (row.status !== "pending") throw new BadRequestException("This request has already been decided.");
    const updated = await this.prisma.leaveRequest.update({ where: { id }, data: { status: dto.status, reviewedBy: reviewer.name, reviewNote: dto.note?.trim() || null } });
    await this.activity.log({ kind: "staff", id: reviewer.sub, name: reviewer.name }, dto.status, `${dto.status === "approved" ? "Approved" : "Declined"} ${row.staff.name}'s leave`, { type: "leave-requests", id }, {
      kind: "updated",
      model: "leaveRequest",
      id,
      before: { status: "pending", reviewedBy: null, reviewNote: null },
      after: { status: updated.status, reviewedBy: updated.reviewedBy, reviewNote: updated.reviewNote },
      topic: "leave-requests",
    });
    await this.notifications.notify("staff", [row.staffId], { title: `Your leave was ${dto.status}`, body: dto.note, link: "/admin/me", email: true });
    this.events.emit(["leave-requests"]);
    return updated;
  }

  /** Who is away today and in the next two weeks. */
  async whoIsAway() {
    const today = day(new Date().toISOString());
    const soon = new Date(today.getTime() + 14 * 86400_000);
    return this.prisma.leaveRequest.findMany({
      where: { status: "approved", startDate: { lte: soon }, endDate: { gte: today } },
      include: { staff: { select: { name: true, jobTitle: true } } },
      orderBy: { startDate: "asc" },
    });
  }
}
