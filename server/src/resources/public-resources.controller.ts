import { Controller, Get, Param, Query } from "@nestjs/common";
import { splitListQuery } from "../common/actor";
import { ResourceService } from "./resource.service";

/**
 * Read-only data for the public website: only resources with a `public` section in registry.ts,
 * only their published records and only the fields listed there.
 */
@Controller("public/r")
export class PublicResourcesController {
  constructor(private readonly resources: ResourceService) {}

  @Get(":resource")
  list(@Param("resource") resource: string, @Query() query: Record<string, unknown>) {
    return this.resources.publicList(resource, splitListQuery(query));
  }

  @Get(":resource/:idOrSlug")
  get(@Param("resource") resource: string, @Param("idOrSlug") idOrSlug: string) {
    return this.resources.publicGet(resource, idOrSlug);
  }
}
