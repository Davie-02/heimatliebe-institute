import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { StaffRoute } from "../auth/roles.decorator";
import { CurrentStaff, type StaffActor } from "../access/current-staff.decorator";
import { HrService } from "./hr.service";
import { LeaveDecisionDto, LeaveRequestDto } from "./hr.dto";

@Controller("hr")
@StaffRoute()
export class HrController {
  constructor(private readonly hr: HrService) {}

  @Get("leave/me")
  mine(@CurrentStaff() me: StaffActor) {
    return this.hr.myLeave(me.sub);
  }

  @Post("leave/me")
  request(@CurrentStaff() me: StaffActor, @Body() dto: LeaveRequestDto) {
    return this.hr.request(me, dto);
  }

  @Delete("leave/me/:id")
  cancel(@CurrentStaff() me: StaffActor, @Param("id") id: string) {
    return this.hr.cancel(me.sub, id);
  }

  @Post("leave/:id/decide")
  decide(@CurrentStaff() me: StaffActor, @Param("id") id: string, @Body() dto: LeaveDecisionDto) {
    return this.hr.decide(me, id, dto);
  }

  @Get("away")
  away() {
    return this.hr.whoIsAway();
  }
}
