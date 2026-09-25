import { Controller, Get, Header } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SiteContentService } from "../site/site-content.service";

/** Escapes text for the iCalendar format (RFC 5545) and folds long lines. */
export function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function fold(line: string): string {
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    parts.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  parts.push(rest);
  return parts.join("\r\n");
}

const icsDate = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
const siteUrl = () => (process.env.FRONTEND_URL ?? "http://localhost:5173").replace(/\/+$/, "");

/**
 * Feeds other programs can read: the public calendar (subscribe in Google Calendar, Outlook or a
 * phone), the sitemap search engines use to find every course and article, and robots.txt.
 */
@Controller("public")
export class FeedsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly content: SiteContentService
  ) {}

  @Get("calendar.ics")
  @Header("Content-Type", "text/calendar; charset=utf-8")
  @Header("Cache-Control", "public, max-age=900")
  async calendar() {
    const institution = await this.content.get("institution");
    const since = new Date(Date.now() - 60 * 86400_000);
    const [events, sessions] = await Promise.all([
      this.prisma.calendarEvent.findMany({ where: { public: true, startDate: { gte: since } }, orderBy: { startDate: "asc" }, take: 500 }),
      this.prisma.examSession.findMany({ where: { published: true, examDate: { gte: since } }, orderBy: { examDate: "asc" }, take: 200 }),
    ]);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Heimatliebe Institute//Calendar//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsText(institution.name)}`];
    const add = (uid: string, title: string, start: Date, end: Date | null, description?: string | null) => {
      const last = new Date((end ?? start).getTime() + 86400_000);
      lines.push("BEGIN:VEVENT", `UID:${uid}@heimatliebe`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${icsDate(start)}`, `DTEND;VALUE=DATE:${icsDate(last)}`, fold(`SUMMARY:${icsText(title)}`));
      if (description) lines.push(fold(`DESCRIPTION:${icsText(description)}`));
      lines.push("END:VEVENT");
    };
    for (const e of events) add(e.id, e.title, e.startDate, e.endDate, e.description);
    for (const s of sessions) add(s.id, `${s.title} (${s.provider})`, s.examDate, null, s.venue ? `Venue: ${s.venue}` : null);
    lines.push("END:VCALENDAR");
    return lines.join("\r\n") + "\r\n";
  }

  @Get("sitemap.xml")
  @Header("Content-Type", "application/xml; charset=utf-8")
  @Header("Cache-Control", "public, max-age=3600")
  async sitemap() {
    const base = siteUrl();
    const [courses, news] = await Promise.all([
      this.prisma.course.findMany({ where: { published: true }, select: { slug: true, updatedAt: true } }),
      this.prisma.newsPost.findMany({ where: { published: true }, select: { slug: true, publishedAt: true } }),
    ]);
    const pages = ["", "/courses", "/about", "/apply", "/placement-test", "/exams", "/news", "/gallery", "/library", "/calendar", "/faq", "/contact", "/verify"];
    const url = (loc: string, lastmod?: Date | null) => `<url><loc>${base}${loc}</loc>${lastmod ? `<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : ""}</url>`;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[
      ...pages.map((p) => url(p)),
      ...courses.map((c) => url(`/courses/${c.slug}`, c.updatedAt)),
      ...news.map((n) => url(`/news/${n.slug}`, n.publishedAt)),
    ].join("")}</urlset>`;
  }

  @Get("robots.txt")
  @Header("Content-Type", "text/plain; charset=utf-8")
  robots() {
    return `User-agent: *\nDisallow: /admin\nDisallow: /portal\nAllow: /\nSitemap: ${siteUrl()}/sitemap.xml\n`;
  }
}
