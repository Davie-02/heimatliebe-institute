import { Body, Controller, Delete, Get, Param, Put } from "@nestjs/common";
import { IsString, MaxLength } from "class-validator";
import { StaffRoute } from "../auth/roles.decorator";
import { GuidesService } from "./guides.service";

class GuideDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(20_000)
  body!: string;
}

@Controller("guides")
@StaffRoute()
export class GuidesController {
  constructor(private readonly guides: GuidesService) {}

  @Get()
  list() {
    return this.guides.list();
  }

  @Put(":key")
  save(@Param("key") key: string, @Body() dto: GuideDto) {
    return this.guides.save(key, dto.title.trim(), dto.body.trim());
  }

  @Delete(":key")
  reset(@Param("key") key: string) {
    return this.guides.reset(key);
  }
}
