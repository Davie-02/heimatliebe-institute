import { Body, Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { StaffRoute } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { SessionClaims } from "../auth/session.service";
import { actorFrom } from "../common/actor";
import { StudentAuthService } from "../auth/student-auth.service";
import { AdmissionsService } from "./admissions.service";
import { AcceptApplicationDto, ApplicationDto, ApplicationStatusDto, EnquiryDto, ExamRegistrationDto, PlacementSubmitDto, TrackApplicationDto } from "./admissions.dto";

/** Forms anyone can use on the public website. Each is rate-limited per network address. */
@Controller("public")
export class PublicAdmissionsController {
  constructor(private readonly admissions: AdmissionsService) {}

  @Get("placement")
  languages() {
    return this.admissions.placementLanguages();
  }

  @Get("placement/:language")
  questions(@Param("language") language: string) {
    return this.admissions.placementQuestions(language);
  }

  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  @Post("placement")
  @HttpCode(200)
  submitPlacement(@Body() dto: PlacementSubmitDto) {
    return this.admissions.submitPlacement(dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  @Post("applications")
  apply(@Body() dto: ApplicationDto, @Req() request: Request) {
    return this.admissions.apply(dto, request.ip);
  }

  @Throttle({ default: { limit: 20, ttl: 60 * 60_000 } })
  @Post("applications/track")
  @HttpCode(200)
  track(@Body() dto: TrackApplicationDto) {
    return this.admissions.track(dto.reference, dto.email);
  }

  @Throttle({ default: { limit: 8, ttl: 60 * 60_000 } })
  @Post("enquiries")
  enquire(@Body() dto: EnquiryDto, @Req() request: Request) {
    return this.admissions.enquire(dto, request.ip);
  }

  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  @Post("exam-registrations")
  register(@Body() dto: ExamRegistrationDto, @Req() request: Request) {
    return this.admissions.registerForExam(dto, request.ip);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get("certificates/:code")
  verify(@Param("code") code: string) {
    return this.admissions.verifyCertificate(code);
  }
}

/** Admissions desk actions that go beyond editing a record. */
@Controller()
@StaffRoute()
export class AdmissionsController {
  constructor(
    private readonly admissions: AdmissionsService,
    private readonly studentAuth: StudentAuthService
  ) {}

  @Get("admissions/summary")
  summary() {
    return this.admissions.summary();
  }

  @Post("admissions/applications/:id/accept")
  @HttpCode(200)
  accept(@Param("id") id: string, @Body() dto: AcceptApplicationDto, @CurrentUser() user: SessionClaims, @Req() request: Request) {
    return this.admissions.accept(id, dto, actorFrom(user, request));
  }

  @Post("admissions/applications/:id/status")
  @HttpCode(200)
  status(@Param("id") id: string, @Body() dto: ApplicationStatusDto, @CurrentUser() user: SessionClaims, @Req() request: Request) {
    return this.admissions.setStatus(id, dto, actorFrom(user, request));
  }

  /** (Re)send a student their "choose your password" email. */
  @Post("students/:id/invite")
  @HttpCode(200)
  invite(@Param("id") id: string) {
    return this.studentAuth.invite(id);
  }
}
