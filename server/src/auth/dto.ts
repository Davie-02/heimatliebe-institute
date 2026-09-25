import { IsBoolean, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";
import { IsStrongPassword } from "../security/password-policy";

/**
 * Request bodies for sign-in and account security. The global ValidationPipe (main.ts) rejects
 * anything that doesn't match, including unknown fields.
 */

export class SignInDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  // Deliberately not checked against the strength rules, so older passwords still sign in.
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password!: string;

  /** "Keep me signed in": 30-day session instead of the normal one. */
  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

export class TwoFactorLoginDto {
  @IsString()
  @MaxLength(2048)
  challenge!: string;

  @IsString()
  @MaxLength(20)
  code!: string;
}

export class TwoFactorCodeDto {
  @IsString()
  @MaxLength(20)
  code!: string;
}

export class DisableTwoFactorDto {
  @IsString()
  @MaxLength(200)
  password!: string;

  @IsString()
  @MaxLength(20)
  code!: string;
}

export class FirstPasswordDto {
  @IsString()
  @MaxLength(2048)
  challenge!: string;

  @IsStrongPassword()
  newPassword!: string;
}

export class ConfirmIdentityDto {
  @IsString()
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token!: string;

  @IsStrongPassword()
  newPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  currentPassword!: string;

  @IsStrongPassword()
  newPassword!: string;
}

export class SocialSignInDto {
  @IsIn(["google", "facebook"])
  provider!: "google" | "facebook";

  /** Google's ID token ("credential") or Facebook's access token. */
  @IsString()
  @MaxLength(4096)
  token!: string;

  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}
