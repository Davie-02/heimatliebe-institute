import { Body, Controller, Get, Param, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { StaffRoute } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { SessionClaims } from "../auth/session.service";
import { actorFrom } from "../common/actor";
import { SiteContentService } from "./site-content.service";

@Controller()
export class SiteController {
  constructor(private readonly content: SiteContentService) {}

  /** Everything the public website needs to draw its frame: institute details and homepage text. */
  @Get("public/site")
  publicSite() {
    return this.content.all();
  }

  @Get("site-content")
  @StaffRoute()
  all() {
    return this.content.all();
  }

  @Put("site-content/:key")
  @StaffRoute()
  save(@Param("key") key: string, @Body() body: unknown, @CurrentUser() user: SessionClaims, @Req() request: Request) {
    return this.content.save(key, body, actorFrom(user, request));
  }
}
