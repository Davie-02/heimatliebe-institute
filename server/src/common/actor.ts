import type { Request } from "express";
import type { Actor } from "../activity/activity.service";
import type { SessionClaims } from "../auth/session.service";

/** The activity-log identity of whoever made this request. */
export function actorFrom(user: SessionClaims | undefined, request: Request): Actor & { id: string; name: string } {
  return {
    kind: user?.role === "STUDENT" ? "student" : "staff",
    id: user?.sub ?? "",
    name: user?.name ?? "Unknown",
    ip: request.ip,
  };
}

/** Query-string filters: everything except the paging/sorting/search parameters. */
export function splitListQuery(query: Record<string, unknown>) {
  const { q, page, pageSize, sort, dir, ...rest } = query;
  const filters: Record<string, string> = {};
  for (const [key, value] of Object.entries(rest)) if (typeof value === "string") filters[key] = value;
  return {
    q: typeof q === "string" ? q : undefined,
    page: Number(page) || undefined,
    pageSize: Number(pageSize) || undefined,
    sort: typeof sort === "string" ? sort : undefined,
    dir: dir === "asc" || dir === "desc" ? dir : undefined,
    filters,
  } as const;
}
