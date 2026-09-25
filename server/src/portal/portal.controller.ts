import { Body, Controller, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { StudentRoute } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { SessionClaims } from "../auth/session.service";
import { FinanceService } from "../finance/finance.service";
import { PortalService } from "./portal.service";
import { EvaluationDto, ExamAnswersDto, PaymentProofDto, ProfileDto, ScholarshipApplyDto, SubmitAssignmentDto } from "./portal.dto";

/** The signed-in student's own portal: /api/me/… */
@Controller("me")
@StudentRoute()
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly finance: FinanceService
  ) {}

  @Get("dashboard")
  dashboard(@CurrentUser() me: SessionClaims) {
    return this.portal.dashboard(me.sub);
  }

  @Get("profile")
  profile(@CurrentUser() me: SessionClaims) {
    return this.portal.profile(me.sub);
  }

  @Patch("profile")
  updateProfile(@CurrentUser() me: SessionClaims, @Body() dto: ProfileDto) {
    return this.portal.updateProfile(me.sub, dto);
  }

  @Get("classes")
  classes(@CurrentUser() me: SessionClaims) {
    return this.portal.classes(me.sub);
  }

  @Get("timetable")
  timetable(@CurrentUser() me: SessionClaims) {
    return this.portal.timetable(me.sub);
  }

  @Get("announcements")
  announcements() {
    return this.portal.announcements();
  }

  @Get("assignments")
  assignments(@CurrentUser() me: SessionClaims) {
    return this.portal.assignments(me.sub);
  }

  @Post("assignments/:id/submit")
  submit(@CurrentUser() me: SessionClaims, @Param("id") id: string, @Body() dto: SubmitAssignmentDto) {
    return this.portal.submitAssignment(me, id, dto);
  }

  @Get("exams")
  exams(@CurrentUser() me: SessionClaims) {
    return this.portal.exams(me.sub);
  }

  @Post("exams/:id/start")
  startExam(@CurrentUser() me: SessionClaims, @Param("id") id: string) {
    return this.portal.startExam(me.sub, id);
  }

  @Put("exams/:id")
  saveExam(@CurrentUser() me: SessionClaims, @Param("id") id: string, @Body() dto: ExamAnswersDto) {
    return this.portal.saveExam(me.sub, id, dto);
  }

  @Get("results")
  results(@CurrentUser() me: SessionClaims) {
    return this.portal.results(me.sub);
  }

  @Get("attendance")
  attendance(@CurrentUser() me: SessionClaims) {
    return this.portal.attendance(me.sub);
  }

  @Get("certificates")
  certificates(@CurrentUser() me: SessionClaims) {
    return this.portal.certificates(me.sub);
  }

  @Get("fees")
  fees(@CurrentUser() me: SessionClaims) {
    return this.portal.fees(me.sub);
  }

  @Get("fees/statement")
  statement(@CurrentUser() me: SessionClaims) {
    return this.finance.statement(me.sub);
  }

  @Get("fees/receipts/:id")
  receipt(@CurrentUser() me: SessionClaims, @Param("id") id: string) {
    return this.finance.receipt(id, me.sub);
  }

  @Post("payments")
  reportPayment(@CurrentUser() me: SessionClaims, @Body() dto: PaymentProofDto) {
    return this.portal.reportPayment(me, dto);
  }

  @Post("classes/:id/evaluation")
  evaluate(@CurrentUser() me: SessionClaims, @Param("id") id: string, @Body() dto: EvaluationDto) {
    return this.portal.evaluate(me.sub, id, dto);
  }

  @Get("scholarships")
  scholarships(@CurrentUser() me: SessionClaims) {
    return this.portal.scholarships(me.sub);
  }

  @Post("scholarships/:id/apply")
  applyScholarship(@CurrentUser() me: SessionClaims, @Param("id") id: string, @Body() dto: ScholarshipApplyDto) {
    return this.portal.applyScholarship(me.sub, id, dto);
  }

  @Get("library")
  library(@Query() query: { q?: string; language?: string; level?: string }) {
    return this.portal.library(query);
  }

  @Get("apps")
  apps() {
    return this.portal.apps();
  }
}
