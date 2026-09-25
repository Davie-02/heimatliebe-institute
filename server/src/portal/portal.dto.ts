import { IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsPositive, IsString, Matches, Max, MaxLength, Min } from "class-validator";

export class SubmitAssignmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(50_000)
  content?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  fileUrl?: string;
}

export class ExamAnswersDto {
  @IsObject()
  answers!: Record<string, unknown>;

  /** Hand in now (otherwise just save progress). */
  @IsOptional()
  @IsBoolean()
  submit?: boolean;
}

export class PaymentProofDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  invoiceId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(1e9)
  amount!: number;

  @IsIn(["airtel", "tnm", "bank", "cash", "card"])
  method!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @IsString()
  @MaxLength(2000)
  proofUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class EvaluationDto {
  @IsInt()
  @Min(1)
  @Max(5)
  courseRating!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  teacherRating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  comments?: string;
}

export class ScholarshipApplyDto {
  @IsString()
  @MaxLength(5000)
  statement!: string;
}

export class ProfileDto {
  @IsOptional()
  @Matches(/^$|^[+0-9 ()./-]{6,24}$/, { message: "Enter a valid phone number." })
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  guardianName?: string;

  @IsOptional()
  @Matches(/^$|^[+0-9 ()./-]{6,24}$/, { message: "Enter a valid phone number." })
  guardianPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  photoUrl?: string;
}
