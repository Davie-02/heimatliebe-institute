import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EventsService } from "../events/events.service";
import { NotificationsService, type PersonKind } from "./notifications.service";

export interface Person {
  kind: PersonKind;
  id: string;
  name: string;
}

/**
 * Private messages between staff and students (and staff with each other).
 * Students may message staff only; staff may message anyone. Each new message tells the other
 * participants' open screens to refresh and adds a notification to their bell.
 */
@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService
  ) {}

  static topic(kind: PersonKind, id: string) {
    return `messages:${kind}:${id}`;
  }

  async conversations(me: Person) {
    const rows = await this.prisma.conversation.findMany({
      where: { participants: { some: { kind: me.kind, personId: me.id } } },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: {
        participants: { select: { kind: true, personId: true, name: true, lastReadAt: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, senderName: true, createdAt: true } },
      },
    });
    return rows.map((row) => {
      const mine = row.participants.find((p) => p.kind === me.kind && p.personId === me.id);
      const last = row.messages[0];
      return {
        id: row.id,
        subject: row.subject,
        updatedAt: row.updatedAt,
        with: row.participants.filter((p) => !(p.kind === me.kind && p.personId === me.id)).map((p) => ({ kind: p.kind, id: p.personId, name: p.name })),
        last: last ?? null,
        unread: Boolean(last && (!mine?.lastReadAt || mine.lastReadAt < last.createdAt)),
      };
    });
  }

  async unreadCount(me: Person): Promise<number> {
    const list = await this.conversations(me);
    return list.filter((c) => c.unread).length;
  }

  private async assertParticipant(conversationId: string, me: Person) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_kind_personId: { conversationId, kind: me.kind, personId: me.id } },
    });
    if (!participant) throw new NotFoundException("Conversation not found.");
  }

  async messages(conversationId: string, me: Person) {
    await this.assertParticipant(conversationId, me);
    const [conversation, messages] = await Promise.all([
      this.prisma.conversation.findUnique({ where: { id: conversationId }, include: { participants: { select: { kind: true, personId: true, name: true } } } }),
      this.prisma.message.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" }, take: 500 }),
    ]);
    await this.prisma.conversationParticipant.update({
      where: { conversationId_kind_personId: { conversationId, kind: me.kind, personId: me.id } },
      data: { lastReadAt: new Date() },
    });
    return { conversation, messages: messages.map((m) => ({ ...m, mine: m.senderKind === me.kind && m.senderId === me.id })) };
  }

  /** Starts a conversation with one or more people, or continues the existing one-to-one conversation. */
  async start(me: Person, to: Array<{ kind: PersonKind; id: string }>, subject: string | undefined, body: string) {
    if (!to.length || to.length > 50) throw new BadRequestException("Choose between 1 and 50 people.");
    if (me.kind === "student" && to.some((r) => r.kind !== "staff")) throw new ForbiddenException("Students can message staff only.");
    const names = await this.resolveNames(to);

    if (to.length === 1) {
      const existing = await this.prisma.conversation.findFirst({
        where: {
          AND: [
            { participants: { some: { kind: me.kind, personId: me.id } } },
            { participants: { some: { kind: to[0].kind, personId: to[0].id } } },
            { participants: { every: { OR: [{ kind: me.kind, personId: me.id }, { kind: to[0].kind, personId: to[0].id }] } } },
          ],
        },
        select: { id: true },
      });
      if (existing) return this.send(existing.id, me, body);
    }

    const conversation = await this.prisma.conversation.create({
      data: {
        subject: subject?.trim().slice(0, 200) || null,
        participants: { create: [{ kind: me.kind, personId: me.id, name: me.name, lastReadAt: new Date() }, ...names.map((p) => ({ kind: p.kind, personId: p.id, name: p.name }))] },
      },
    });
    return this.send(conversation.id, me, body);
  }

  async send(conversationId: string, me: Person, body: string) {
    const text = body.trim();
    if (!text) throw new BadRequestException("Write a message first.");
    if (text.length > 5000) throw new BadRequestException("Keep messages under 5,000 characters.");
    await this.assertParticipant(conversationId, me);
    const now = new Date();
    const message = await this.prisma.message.create({ data: { conversationId, senderKind: me.kind, senderId: me.id, senderName: me.name, body: text } });
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: now } });
    await this.prisma.conversationParticipant.update({ where: { conversationId_kind_personId: { conversationId, kind: me.kind, personId: me.id } }, data: { lastReadAt: now } });

    const others = await this.prisma.conversationParticipant.findMany({ where: { conversationId, NOT: { kind: me.kind, personId: me.id } } });
    this.events.emit([...others, { kind: me.kind, personId: me.id }].map((p) => MessagingService.topic(p.kind as PersonKind, p.personId)));
    for (const kind of ["staff", "student"] as const) {
      const ids = others.filter((p) => p.kind === kind).map((p) => p.personId);
      if (ids.length) {
        await this.notifications.notify(kind, ids, { title: `New message from ${me.name}`, body: text.slice(0, 140), link: kind === "student" ? "/portal/messages" : "/admin/messages" });
      }
    }
    return { conversationId, message: { ...message, mine: true } };
  }

  /** People a user may start a conversation with, by name. */
  async recipients(me: Person, q: string) {
    const text = q.trim().slice(0, 60);
    const staff = await this.prisma.staff.findMany({
      where: { isActive: true, NOT: me.kind === "staff" ? { id: me.id } : undefined, ...(text ? { name: { contains: text, mode: "insensitive" } } : {}) },
      select: { id: true, name: true, jobTitle: true },
      take: 15,
      orderBy: { name: "asc" },
    });
    const students =
      me.kind === "staff"
        ? await this.prisma.student.findMany({
            where: { isActive: true, ...(text ? { OR: [{ name: { contains: text, mode: "insensitive" } }, { studentNo: { contains: text, mode: "insensitive" } }] } : {}) },
            select: { id: true, name: true, studentNo: true },
            take: 15,
            orderBy: { name: "asc" },
          })
        : [];
    return [
      ...staff.map((s) => ({ kind: "staff" as const, id: s.id, name: s.name, detail: s.jobTitle ?? "Staff" })),
      ...students.map((s) => ({ kind: "student" as const, id: s.id, name: s.name, detail: s.studentNo })),
    ];
  }

  private async resolveNames(to: Array<{ kind: PersonKind; id: string }>) {
    const staffIds = to.filter((r) => r.kind === "staff").map((r) => r.id);
    const studentIds = to.filter((r) => r.kind === "student").map((r) => r.id);
    const [staff, students] = await Promise.all([
      staffIds.length ? this.prisma.staff.findMany({ where: { id: { in: staffIds }, isActive: true }, select: { id: true, name: true } }) : [],
      studentIds.length ? this.prisma.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, name: true } }) : [],
    ]);
    const found = [...staff.map((s) => ({ kind: "staff" as const, ...s })), ...students.map((s) => ({ kind: "student" as const, ...s }))];
    if (found.length !== to.length) throw new BadRequestException("One of the recipients wasn't found.");
    return found;
  }
}
