import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { StaffRoute } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { SessionClaims } from "../auth/session.service";
import { actorFrom, splitListQuery } from "../common/actor";
import { ResourceService } from "./resource.service";

/**
 * Staff screens for every resource in registry.ts: /api/r/<resource>.
 * Who may use each route is decided by access/route-access.ts (the resource's module and level).
 */
@Controller("r")
@StaffRoute()
export class ResourcesController {
  constructor(private readonly resources: ResourceService) {}

  @Get("_schema")
  schema() {
    return this.resources.schema();
  }

  @Get(":resource/options")
  options(@Param("resource") resource: string, @Query("q") q?: string, @Query("ids") ids?: string) {
    return this.resources.options(resource, q, ids ? ids.split(",") : undefined);
  }

  @Get(":resource/export")
  async export(@Param("resource") resource: string, @Query() query: Record<string, unknown>, @Res() response: Response) {
    const { filename, csv } = await this.resources.exportCsv(resource, splitListQuery(query));
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    response.send(csv);
  }

  @Get(":resource")
  list(@Param("resource") resource: string, @Query() query: Record<string, unknown>) {
    return this.resources.list(resource, splitListQuery(query));
  }

  @Get(":resource/:id")
  get(@Param("resource") resource: string, @Param("id") id: string) {
    return this.resources.get(resource, id);
  }

  @Post(":resource")
  create(@Param("resource") resource: string, @Body() body: unknown, @CurrentUser() user: SessionClaims, @Req() request: Request) {
    return this.resources.create(resource, body, actorFrom(user, request));
  }

  @Patch(":resource/:id")
  update(@Param("resource") resource: string, @Param("id") id: string, @Body() body: unknown, @CurrentUser() user: SessionClaims, @Req() request: Request) {
    return this.resources.update(resource, id, body, actorFrom(user, request));
  }

  @Delete(":resource/:id")
  remove(@Param("resource") resource: string, @Param("id") id: string, @CurrentUser() user: SessionClaims, @Req() request: Request) {
    return this.resources.remove(resource, id, actorFrom(user, request));
  }
}
