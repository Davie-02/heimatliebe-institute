import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";
import type { Request } from "express";
import { StaffRoute } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { SessionClaims } from "../auth/session.service";
import { actorFrom } from "../common/actor";
import { AssistantService } from "./assistant.service";

class TurnDto {
  @IsIn(["user", "model"])
  role!: "user" | "model";

  @IsString()
  @MaxLength(3000)
  text!: string;
}

class ChatDto {
  @IsString()
  @MaxLength(600)
  message!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => TurnDto)
  history?: TurnDto[];
}

class PublishSuggestionDto {
  @IsString()
  @MaxLength(300)
  question!: string;

  @IsString()
  @MaxLength(5000)
  answer!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;
}

@Controller("assistant")
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get("status")
  status() {
    return this.assistant.status();
  }

  // Generous for a person chatting, tight enough that nobody can drain the free model quota.
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Post("chat")
  @HttpCode(200)
  chat(@Body() dto: ChatDto) {
    return this.assistant.chat(dto.message, dto.history ?? []);
  }

  @Get("admin/stats")
  @StaffRoute()
  stats() {
    return this.assistant.stats();
  }

  @Get("admin/logs")
  @StaffRoute()
  logs(@Query("unanswered") unanswered?: string) {
    return this.assistant.logs({ unanswered: unanswered === "true" });
  }

  @Get("admin/suggestions")
  @StaffRoute()
  suggestions(@Query("status") status?: string) {
    return this.assistant.suggestions(status === "published" || status === "dismissed" ? status : "draft");
  }

  @Post("admin/suggestions/refresh")
  @HttpCode(200)
  @StaffRoute()
  refresh() {
    return this.assistant.refreshNow();
  }

  @Post("admin/suggestions/:id/publish")
  @HttpCode(200)
  @StaffRoute()
  publish(@Param("id") id: string, @Body() dto: PublishSuggestionDto, @CurrentUser() user: SessionClaims, @Req() request: Request) {
    return this.assistant.publishSuggestion(id, dto, actorFrom(user, request));
  }

  @Post("admin/suggestions/:id/dismiss")
  @HttpCode(200)
  @StaffRoute()
  dismiss(@Param("id") id: string) {
    return this.assistant.dismissSuggestion(id);
  }

  /** Staff can try a question and see exactly what visitors would get. */
  @Post("admin/test")
  @HttpCode(200)
  @StaffRoute()
  test(@Body() dto: ChatDto) {
    return this.assistant.chat(dto.message, dto.history ?? []);
  }
}
