import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";

export class RecipientDto {
  @IsIn(["staff", "student"])
  kind!: "staff" | "student";

  @IsString()
  @MaxLength(64)
  id!: string;
}

export class StartConversationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RecipientDto)
  to!: RecipientDto[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsString()
  @MaxLength(5000)
  body!: string;
}

export class SendMessageDto {
  @IsString()
  @MaxLength(5000)
  body!: string;
}
