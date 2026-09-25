import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { StaffRoute } from "../auth/roles.decorator";
import { CurrentStaff, type StaffActor } from "../access/current-staff.decorator";
import { TeachingService } from "./teaching.service";
import { AssignmentDto, AttendanceDto, ExamDto, GradeSubmissionDto, MarkAttemptDto, NotifyClassDto, SkillAssessmentDto } from "./teaching.dto";

@Controller("teaching")
@StaffRoute()
export class TeachingController {
  constructor(private readonly teaching: TeachingService) {}

  @Get("classes")
  classes(@CurrentStaff() me: StaffActor, @Query("all") all?: string) {
    return this.teaching.myClasses(me, all === "true");
  }

  @Get("today")
  today(@CurrentStaff() me: StaffActor) {
    return this.teaching.today(me);
  }

  @Get("classes/:id")
  roster(@CurrentStaff() me: StaffActor, @Param("id") id: string) {
    return this.teaching.roster(me, id);
  }

  @Get("classes/:id/attendance")
  attendance(@CurrentStaff() me: StaffActor, @Param("id") id: string, @Query("date") date: string) {
    return this.teaching.attendance(me, id, date || new Date().toISOString().slice(0, 10));
  }

  @Put("classes/:id/attendance")
  saveAttendance(@CurrentStaff() me: StaffActor, @Param("id") id: string, @Body() dto: AttendanceDto) {
    return this.teaching.saveAttendance(me, id, dto);
  }

  @Get("classes/:id/assignments")
  assignments(@CurrentStaff() me: StaffActor, @Param("id") id: string) {
    return this.teaching.assignments(me, id);
  }

  @Post("classes/:id/assignments")
  createAssignment(@CurrentStaff() me: StaffActor, @Param("id") id: string, @Body() dto: AssignmentDto) {
    return this.teaching.createAssignment(me, id, dto);
  }

  @Patch("assignments/:id")
  updateAssignment(@CurrentStaff() me: StaffActor, @Param("id") id: string, @Body() dto: AssignmentDto) {
    return this.teaching.updateAssignment(me, id, dto);
  }

  @Delete("assignments/:id")
  deleteAssignment(@CurrentStaff() me: StaffActor, @Param("id") id: string) {
    return this.teaching.deleteAssignment(me, id);
  }

  @Get("assignments/:id/submissions")
  submissions(@CurrentStaff() me: StaffActor, @Param("id") id: string) {
    return this.teaching.submissions(me, id);
  }

  @Post("submissions/:id/grade")
  grade(@CurrentStaff() me: StaffActor, @Param("id") id: string, @Body() dto: GradeSubmissionDto) {
    return this.teaching.gradeSubmission(me, id, dto);
  }

  @Get("classes/:id/exams")
  exams(@CurrentStaff() me: StaffActor, @Param("id") id: string) {
    return this.teaching.exams(me, id);
  }

  @Post("classes/:id/exams")
  createExam(@CurrentStaff() me: StaffActor, @Param("id") id: string, @Body() dto: ExamDto) {
    return this.teaching.createExam(me, id, dto);
  }

  @Get("exams/:id")
  exam(@CurrentStaff() me: StaffActor, @Param("id") id: string) {
    return this.teaching.getExam(me, id);
  }

  @Put("exams/:id")
  updateExam(@CurrentStaff() me: StaffActor, @Param("id") id: string, @Body() dto: ExamDto) {
    return this.teaching.updateExam(me, id, dto);
  }

  @Get("exams/:id/attempts")
  attempts(@CurrentStaff() me: StaffActor, @Param("id") id: string) {
    return this.teaching.attempts(me, id);
  }

  @Post("attempts/:id/mark")
  mark(@CurrentStaff() me: StaffActor, @Param("id") id: string, @Body() dto: MarkAttemptDto) {
    return this.teaching.markAttempt(me, id, dto);
  }

  @Get("classes/:id/gradebook")
  gradebook(@CurrentStaff() me: StaffActor, @Param("id") id: string) {
    return this.teaching.gradebook(me, id);
  }

  @Post("classes/:id/skills")
  skills(@CurrentStaff() me: StaffActor, @Param("id") id: string, @Body() dto: SkillAssessmentDto) {
    return this.teaching.addSkillAssessment(me, id, dto);
  }

  @Post("classes/:id/notify")
  notify(@CurrentStaff() me: StaffActor, @Param("id") id: string, @Body() dto: NotifyClassDto) {
    return this.teaching.notifyClass(me, id, dto.title, dto.body, dto.email === true);
  }
}
