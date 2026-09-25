# Heimatliebe Institute

Website, student portal and staff workspace for **Heimatliebe Institute**, a private international language school in Karonga, Malawi.

| | |
|---|---|
| **Public website** | Courses, free online placement test, online applications with tracking, official exam registration, news, gallery, library, calendar (with a subscribable calendar feed), FAQ, certificate verification, contact form, WhatsApp button and a website assistant that answers from the institute's own information. |
| **Student portal** (`/portal`) | Classes and timetable (with online-lesson links), assignments with file hand-in, online exams with a server-side timer and autosave, results and CEFR skills reports, attendance, fees with payment-proof upload, receipts and statements, certificates, scholarships, members' library, apps (Google Classroom, Meet…), messages and notifications. |
| **Staff workspace** (`/admin`) | Admissions (applications → one-click accept that creates the student, class place, invoice and portal invitation; enquiries with follow-up dates; placement results; exam registrations), students, teaching (register, assignments and marking, exam builder with automatic marking, gradebook, skills reports), academics (courses, classes, timetable, calendar, exam sessions), finance (payment confirmation queue, receipts, bulk invoicing, statements, debtors, automatic overdue marking and reminders), website content, announcements, messages, HR (leave), reports, staff & access, activity log with undo, guides, integrations (apps, webhooks) and system status. |

Everything updates **live**: when someone saves a change, every open screen that shows it refreshes within a second.

## Technology

| Part | Technology | Hosting (free, no card) |
|---|---|---|
| Website | React 18 + TypeScript + Vite | Vercel |
| API | NestJS 10 + Prisma 5 (TypeScript) | Render |
| Database | PostgreSQL | Neon |
| Email | Brevo (HTTPS API) | Brevo free plan (300/day) |
| Files | Any S3-compatible bucket | Backblaze B2 or Cloudflare R2 |
| Website assistant (optional) | Google Gemini | Free API key |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together and [docs/SECURITY.md](docs/SECURITY.md) for how accounts and data are protected.

## Running it on your computer

You need Node.js 20+ and PostgreSQL 16.

```bash
# 1. API
cd server
cp .env.example .env          # then fill in DATABASE_URL, JWT_SECRET, ADMIN_* …
npm install
npx prisma migrate dev        # creates the tables
npm run start:dev             # http://localhost:3001/api

# 2. Website (in a second terminal, from the project root)
npm install
npm run dev                   # http://localhost:5173
```

With `SEED_DEMO=true` the API loads example courses, classes, staff and students on first start. Demo accounts use the password `Demo-Password-2026`, for example `teacher@demo.heimatliebe.mw`, `admissions@demo.heimatliebe.mw`, `finance@demo.heimatliebe.mw` and the student `chikondi@demo.heimatliebe.mw`. The system administrator from `ADMIN_EMAIL` / `ADMIN_PASSWORD` signs in at `/admin/login` and is asked to set up two-step verification first.

### Checks

```bash
cd server && npm test && npm run typecheck   # API unit tests
npm test && npm run typecheck                # website (from the project root)
npm run build                                # production build of the website
```

## Branches: test on `staging`, then go live from `main`

| Branch | API (Render) | Website (Vercel) | Data |
|---|---|---|---|
| `staging` | `heimatliebe-api-staging` | preview deployment | a separate Neon branch with demo data |
| `main` | `heimatliebe-api` | production | the live database |

1. Work on `staging` (or a feature branch merged into it) and push. GitHub runs the tests; Render and Vercel deploy the staging copy.
2. Check the change on the staging website.
3. Merge `staging` into `main` (a pull request, or `git checkout main && git merge staging && git push`). The live site updates.

Full setup steps for the hosting accounts: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Where things are

```
src/                     website (React)
  pages/site/            public pages
  pages/portal/          student portal
  pages/admin/           staff workspace
  admin/nav.ts           workspace menu: areas, pages and the access each needs
  services/              API client, live updates, cookie-free sign-in fallback
  styles/                design system (light and dark)
server/                  API (NestJS)
  prisma/schema.prisma   database tables
  src/access/            departments, access levels, which route needs what
  src/resources/         registry of every record type (fields, validation, public fields)
  src/auth/ security/    sign-in, sessions, two-step verification, lockout, password rules
  src/admissions/ teaching/ portal/ finance/ …   one folder per area
docs/                    deployment, architecture and security notes
```

Most new record types need only a table in `schema.prisma` and an entry in `server/src/resources/registry.ts`; the workspace list, forms, search, export, undo and access checks follow automatically.

## Licence

GNU Affero General Public License v3.0 — see [LICENSE](LICENSE).
