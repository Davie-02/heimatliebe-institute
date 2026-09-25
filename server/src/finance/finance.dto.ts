import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsPositive, IsString, Max, MaxLength } from "class-validator";

export class RecordPaymentDto {
  @IsString()
  @MaxLength(64)
  studentId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  invoiceId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(1e9)
  amount!: number;

  @IsIn(["cash", "bank", "airtel", "tnm", "card"])
  method!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RejectPaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class BulkInvoiceDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  classId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @IsString({ each: true })
  studentIds?: string[];

  @IsString()
  @MaxLength(200)
  description!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(1e9)
  amount!: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  /** Don't invoice a student twice for the same description (default on). */
  @IsOptional()
  @IsBoolean()
  skipDuplicates?: boolean;
}
