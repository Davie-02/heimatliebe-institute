import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EventsService } from "../events/events.service";
import { EmailService } from "../email/email.service";
import { notificationEmail } from "../email/templates";
import { frontendUrl } from "../auth/auth.service";

export type PersonKind = "staff" | "student";

export interface NotifyInput {
  title: string;
  body?: string | null;
  /** Path inside the site to open, e.g. "/portal/fees". */
  link?: string;
  /** Also send an email. */
  email?: boolean;
}

/** In-app notifications (the bell), with an optional email copy. Open screens refresh the moment one arrives. */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly mail: EmailService
  ) {}

  static topic(kind: PersonKind, personId: string) {
    return `notify:${kind}:${personId}`;
  }

  async notify(kind: PersonKind, personIds: string[], input: NotifyInput): Promise<void> {
    const ids = [...new Set(personIds.filter(Boolean))];
    if (!ids.length) return;
    await this.prisma.notification.createMany({
      data: ids.map((personId) => ({ kind, personId, title: input.title.slice(0, 200), body: input.body?.slice(0, 2000) ?? null, link: input.link ?? null })),
    });
    this.events.emit(ids.map((id) => NotificationsService.topic(kind, id)));
    if (input.email) {
      const people =
        kind === "student"
          ? await this.prisma.student.findMany({ where: { id: { in: ids } }, select: { name: true, email: true } })
          : await this.prisma.staff.findMany({ where: { id: { in: ids }, isActive: true }, select: { name: true, email: true } });
      for (const person of people) {
        void this.mail.send({ to: person.email, ...notificationEmail({ name: person.name, title: input.title, body: input.body, url: input.link ? `${frontendUrl()}${input.link}` : undefined }) });
      }
    }
  }

  /** Everyone on the staff with at least `level` access to one of the modules (e.g. tell admissions about a new application). */
  async staffWithAccess(check: (row: { role: string; department: string; permissions: unknown }) => boolean): Promise<string[]> {
    const staff = await this.prisma.staff.findMany({ where: { isActive: true }, select: { id: true, role: true, department: true, permissions: true } });
    return staff.filter(check).map((row) => row.id);
  }

  async list(kind: PersonKind, personId: string) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({ where: { kind, personId }, orderBy: { createdAt: "desc" }, take: 50 }),
      this.prisma.notification.count({ where: { kind, personId, readAt: null } }),
    ]);
    return { items, unread };
  }

  async markRead(kind: PersonKind, personId: string, id?: string) {
    await this.prisma.notification.updateMany({ where: { kind, personId, readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } });
    this.events.emit([NotificationsService.topic(kind, personId)]);
    return { ok: true };
  }
}
