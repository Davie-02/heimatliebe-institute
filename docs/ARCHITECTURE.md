# Architecture

```
 Browser ──▶ Vercel (website files, forwards /api) ──▶ Render (NestJS API) ──▶ Neon (PostgreSQL)
    │                                                        │
    └────────── live updates (Server-Sent Events) ◀──────────┤──▶ Brevo (email)
                                                             ├──▶ Backblaze B2 / R2 (files)
                                                             └──▶ Gemini (website assistant)
```

## Website (`src/`)

- **One app, three areas**: public site, `/portal` (students) and `/admin` (staff). Every page is a separate download, fetched only when opened, so the first visit is about 70 KB (compressed) — quick on a slow mobile connection.
- **`services/api.ts`** is the only way pages talk to the API. It attaches the sign-in, the anti-forgery (CSRF) token and turns errors into readable messages.
- **`services/live.ts`** keeps one Server-Sent Events connection while the tab is visible. The server sends only topic names ("payments", "notify:student:…"); `useData(path, topics)` refetches when one of its topics changes.
- **Generic record screens**: `GET /api/r/_schema` describes every record type (fields, labels, options). `pages/admin/ResourcePage.tsx` and `RecordPage.tsx` build lists and forms from it; special workflows (accepting applications, confirming payments, registers, exams) have their own screens.
- **Design system** in `src/styles`: system fonts, CSS variables for light and dark themes, animations only on transform/opacity and switched off for people who prefer reduced motion. Icons come from one small SVG sprite (`public/img/icons.svg`).
- **Offline**: `public/sw.js` caches the site's files for instant repeat visits and shows an offline page when there's no connection. API responses are never cached by it.

## API (`server/src/`)

- **Access** (`access/`): staff belong to a department; each department grants a level (none, view, edit, manage) on each area; a system administrator can override per person. `route-access.ts` maps every staff URL to the area and level it needs, and `RolesGuard` enforces it in one place. Unknown staff routes are refused.
- **Resources** (`resources/`): `registry.ts` lists every record type, its fields and rules, which area it belongs to and what the public may read. One service does listing, validation, create/update/delete, activity logging with undo, live-update topics and webhooks for all of them.
- **Activity & undo** (`activity/`): every change stores what it changed; undo puts it back, but refuses if someone has changed the record since.
- **Areas**: `admissions/`, `teaching/`, `portal/` (student-facing), `finance/`, `hr/`, `staff/`, `messaging/`, `site/` (website text and institute settings), `assistant/`, `reports/`, `uploads/`, `integrations/` (webhooks, calendar feed, sitemap).
- **Scheduled jobs**: overdue invoices (daily), fee reminders (Mondays), assistant FAQ suggestions (nightly), clean-up of old sign-out records and assistant logs.

## Database (`server/prisma/schema.prisma`)

Two kinds of accounts: `Staff` and `Student`. Money is stored as exact decimals. Changing the schema: edit the file, run `npx prisma migrate dev --name what-changed`, commit the new folder under `prisma/migrations`; Render applies it on the next deploy.

## Webhooks

Other systems can subscribe (System → Webhooks) to events such as `applications.created`, `applications.accepted`, `payments.confirmed`, `students.created` or `*`. Each delivery is a JSON POST signed with `X-Heimatliebe-Signature: sha256=HMAC(secret, "<timestamp>.<body>")` and `X-Heimatliebe-Timestamp`. Addresses on private networks are refused.
