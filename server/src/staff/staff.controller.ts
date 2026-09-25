import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { StaffRoute } from "../auth/roles.decorator";
import { CurrentStaff, type StaffActor } from "../access/current-staff.decorator";
import { StaffService } from "./staff.service";
import { InviteStaffDto, UpdateMyProfileDto, UpdateStaffDto } from "./staff.dto";

@Controller()
@StaffRoute()
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get("staff-accounts/options")
  options(@Query("q") q?: string) {
    return this.staff.options(q);
  }

  @Get("staff-accounts/meta")
  meta() {
    return this.staff.meta();
  }

  @Get("staff-accounts")
  list(@Query() query: { q?: string; department?: string; active?: string }) {
    return this.staff.list(query);
  }

  @Get("staff-accounts/:id")
  get(@Param("id") id: string) {
    return this.staff.get(id);
  }

  @Post("staff-accounts")
  invite(@Body() dto: InviteStaffDto, @CurrentStaff() viewer: StaffActor, @Req() request: Request) {
    return this.staff.invite(dto, { ...viewer, ip: request.ip });
  }

  @Patch("staff-accounts/:id")
  update(@Param("id") id: string, @Body() dto: UpdateStaffDto, @CurrentStaff() viewer: StaffActor, @Req() request: Request) {
    return this.staff.update(id, dto, { ...viewer, ip: request.ip });
  }

  @Post("staff-accounts/:id/resend-invitation")
  resend(@Param("id") id: string, @CurrentStaff() viewer: StaffActor, @Req() request: Request) {
    return this.staff.resendInvitation(id, { ...viewer, ip: request.ip });
  }

  @Post("staff-accounts/:id/reset-2fa")
  resetTwoFactor(@Param("id") id: string, @CurrentStaff() viewer: StaffActor, @Req() request: Request) {
    return this.staff.resetTwoFactor(id, { ...viewer, ip: request.ip });
  }

  @Get("hr/directory")
  directory() {
    return this.staff.directory();
  }

  @Patch("workspace/profile")
  updateProfile(@CurrentStaff() viewer: StaffActor, @Body() dto: UpdateMyProfileDto) {
    return this.staff.updateMyProfile(viewer.sub, dto);
  }
}
