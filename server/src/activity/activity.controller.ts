import { Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { StaffRoute } from "../auth/roles.decorator";
import { CurrentStaff, type StaffActor } from "../access/current-staff.decorator";
import { ActivityService } from "./activity.service";

@Controller("activity")
@StaffRoute()
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  list(@CurrentStaff() me: StaffActor, @Query() query: { mine?: string; entity?: string; entityId?: string; cursor?: string }) {
    return this.activity.list({ id: me.sub, role: me.role, access: me.access }, { mine: query.mine === "true", entity: query.entity, entityId: query.entityId, cursor: query.cursor });
  }

  @Post(":id/undo")
  @HttpCode(200)
  undo(@CurrentStaff() me: StaffActor, @Param("id") id: string, @Req() request: Request) {
    return this.activity.undo(id, { id: me.sub, name: me.name, role: me.role, access: me.access }, request.ip);
  }
}
