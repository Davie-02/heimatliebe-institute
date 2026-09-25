import { IsBoolean, IsEmail, IsIn, IsObject, IsOptional, IsString, MaxLength } from "class-validator";
import { DEPARTMENTS } from "../access/modules";

const DEPARTMENT_KEYS = Object.keys(DEPARTMENTS);

export class InviteStaffDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsIn(DEPARTMENT_KEYS)
  department!: string;

  @IsOptional()
  @IsIn(["EMPLOYEE", "MANAGER", "OWNER"])
  role?: "EMPLOYEE" | "MANAGER" | "OWNER";

  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;
}

export class UpdateStaffDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @IsOptional()
  @IsIn(DEPARTMENT_KEYS)
  department?: string;

  @IsOptional()
  @IsIn(["EMPLOYEE", "MANAGER", "OWNER"])
  role?: "EMPLOYEE" | "MANAGER" | "OWNER";

  /** Per-person overrides: { finance: "view", teaching: "none" }. */
  @IsOptional()
  @IsObject()
  permissions?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateMyProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  photoUrl?: string;
}
