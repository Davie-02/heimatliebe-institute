import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export class LeaveRequestDto {
  @IsIn(["annual", "sick", "maternity", "study", "unpaid", "other"])
  type!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class LeaveDecisionDto {
  @IsIn(["approved", "rejected"])
  status!: "approved" | "rejected";

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
