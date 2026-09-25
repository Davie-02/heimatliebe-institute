import { IsBoolean, IsDateString, IsEmail, IsIn, IsNumber, IsObject, IsOptional, IsString, Matches, MaxLength, Min } from "class-validator";

const PHONE = /^[+0-9 ()./-]{6,24}$/;
const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"];

export class PlacementSubmitDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @Matches(PHONE, { message: "Enter a valid phone number." })
  phone?: string;

  @IsString()
  @MaxLength(40)
  language!: string;

  @IsObject()
  answers!: Record<string, number>;
}

export class ApplicationDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsEmail({}, { message: "Enter a valid email address." })
  @MaxLength(254)
  email!: string;

  @Matches(PHONE, { message: "Enter a valid phone number." })
  phone!: string;

  @IsString()
  @MaxLength(160)
  course!: string;

  @IsIn(CEFR)
  level!: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  gender?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nationality?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  guardianName?: string;

  @IsOptional()
  @Matches(PHONE, { message: "Enter a valid guardian phone number." })
  guardianPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  preferredSchedule?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  motivation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  placementAttemptId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  paymentProofUrl?: string;

  /** Hidden field real people never fill in; bots that do are quietly ignored. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

export class TrackApplicationDto {
  @IsString()
  @MaxLength(20)
  reference!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class EnquiryDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsEmail({}, { message: "Enter a valid email address." })
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @Matches(PHONE, { message: "Enter a valid phone number." })
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  interest?: string;

  @IsString()
  @MaxLength(3000)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

export class ExamRegistrationDto {
  @IsString()
  @MaxLength(64)
  sessionId!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsEmail({}, { message: "Enter a valid email address." })
  @MaxLength(254)
  email!: string;

  @Matches(PHONE, { message: "Enter a valid phone number." })
  phone!: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  passportNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  modules?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  paymentProofUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

export class AcceptApplicationDto {
  /** Put the new student straight into this class. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  classId?: string;

  @IsOptional()
  @IsIn(CEFR)
  level?: string;

  /** First invoice (e.g. term tuition). Leave out to invoice later. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  invoiceAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  invoiceDescription?: string;

  @IsOptional()
  @IsDateString()
  invoiceDueDate?: string;

  /** Email the student a link to choose their portal password (default yes). */
  @IsOptional()
  @IsBoolean()
  sendInvitation?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}

export class ApplicationStatusDto {
  @IsIn(["pending", "reviewing", "waitlisted", "rejected"])
  status!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;

  /** Email the applicant about the change (default yes). */
  @IsOptional()
  @IsBoolean()
  notify?: boolean;
}
