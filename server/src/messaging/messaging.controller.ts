import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { STAFF_ROLES, type SessionClaims } from "../auth/session.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { MessagingService, type Person } from "./messaging.service";
import { NotificationsService } from "./notifications.service";
import { SendMessageDto, StartConversationDto } from "./messaging.dto";

const person = (user: SessionClaims): Person => ({ kind: user.role === "STUDENT" ? "student" : "staff", id: user.sub, name: user.name });

/** Messages and notifications for everyone signed in, staff and students alike. */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...STAFF_ROLES, "STUDENT")
export class MessagingController {
  constructor(
    private readonly messaging: MessagingService,
    private readonly notifications: NotificationsService
  ) {}

  @Get("messages")
  conversations(@CurrentUser() user: SessionClaims) {
    return this.messaging.conversations(person(user));
  }

  @Get("messages/recipients")
  recipients(@CurrentUser() user: SessionClaims, @Query("q") q = "") {
    return this.messaging.recipients(person(user), q);
  }

  @Get("messages/:id")
  messages(@CurrentUser() user: SessionClaims, @Param("id") id: string) {
    return this.messaging.messages(id, person(user));
  }

  @Post("messages")
  start(@CurrentUser() user: SessionClaims, @Body() dto: StartConversationDto) {
    return this.messaging.start(person(user), dto.to, dto.subject, dto.body);
  }

  @Post("messages/:id")
  send(@CurrentUser() user: SessionClaims, @Param("id") id: string, @Body() dto: SendMessageDto) {
    return this.messaging.send(id, person(user), dto.body);
  }

  @Get("notifications")
  async list(@CurrentUser() user: SessionClaims) {
    const me = person(user);
    const [notes, unreadMessages] = await Promise.all([this.notifications.list(me.kind, me.id), this.messaging.unreadCount(me)]);
    return { ...notes, unreadMessages, topics: [NotificationsService.topic(me.kind, me.id), MessagingService.topic(me.kind, me.id)] };
  }

  @Post("notifications/read")
  @HttpCode(200)
  readAll(@CurrentUser() user: SessionClaims) {
    const me = person(user);
    return this.notifications.markRead(me.kind, me.id);
  }

  @Post("notifications/:id/read")
  @HttpCode(200)
  readOne(@CurrentUser() user: SessionClaims, @Param("id") id: string) {
    const me = person(user);
    return this.notifications.markRead(me.kind, me.id, id);
  }
}
