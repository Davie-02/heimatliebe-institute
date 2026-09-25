import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from "class-validator";

export class AttendanceEntryDto {
  @IsString()
  @MaxLength(64)
  studentId!: string;

  @IsIn(["present", "absent", "late", "excused"])
  status!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}

export class AttendanceDto {
  @IsDateString()
  date!: string;

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AttendanceEntryDto)
  entries!: AttendanceEntryDto[];

  /** Tell absent students straight away. */
  @IsOptional()
  @IsBoolean()
  notifyAbsent?: boolean;
}

export class AssignmentDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  attachmentUrl?: string;

  @IsOptional()
  @IsIn(["reading", "writing", "listening", "speaking", "grammar", "vocabulary", ""])
  skill?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  totalPoints?: number;

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}

export class GradeSubmissionDto {
  @IsNumber()
  @Min(0)
  grade!: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  feedback?: string;
}

export class ExamDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsDateString()
  opensAt?: string;

  @IsOptional()
  @IsDateString()
  closesAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  durationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  passMark?: number;

  @IsOptional()
  @IsBoolean()
  published?: boolean;

  /** Checked in detail by exams/grading.ts validateQuestions. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  questions?: unknown[];
}

export class MarkAttemptDto {
  /** Points per question id for the questions marked by hand. */
  @IsOptional()
  @IsObject()
  marks?: Record<string, number>;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  feedback?: string;
}

export class SkillAssessmentDto {
  @IsString()
  @MaxLength(64)
  studentId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  term?: string;

  @IsOptional() @IsNumber() @Min(0) @Max(100) reading?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) writing?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) listening?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) speaking?: number;

  @IsOptional()
  @IsIn(["A1", "A2", "B1", "B2", "C1", "C2"])
  cefrLevel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  comments?: string;
}

export class NotifyClassDto {
  @IsString()
  @MaxLength(150)
  title!: string;

  @IsString()
  @MaxLength(3000)
  body!: string;

  @IsOptional()
  @IsBoolean()
  email?: boolean;
}
