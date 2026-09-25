# Heimatliebe Institute

Website, admissions and school management system for **Heimatliebe Institute**, a private international language school in Karonga, Malawi.

One system covers the public website, online applications and placement tests, six role-based portals (student, teacher, accounts, HR, director, admin), payments and invoices, exams, attendance, certificates, messaging and Google Workspace integration — and it is built to stay fast on slow mobile connections and older phones.

---

## Contents
1. [Features](#features)
2. [Technology](#technology)
3. [Running it on your computer](#running-it-on-your-computer)
4. [Going live (free hosting)](#going-live-free-hosting)
5. [Working with `staging` and `main`](#working-with-staging-and-main)
6. [Managing the website content](#managing-the-website-content)
7. [Integrations](#integrations)
8. [Security](#security)
9. [Performance](#performance)
10. [Project structure](#project-structure)
11. [Maintenance guide](#maintenance-guide)

---

## Features

### Public website
| Page | What it does |
|---|---|
| Home `/` | Courses, news, gallery, downloads, testimonials, languages and contact form. Every text block is editable by admins. Contact messages go to the enquiries inbox and can open WhatsApp. |
| Placement test `/placement.html` | Free online test (German, English, French, Spanish) that recommends a CEFR level (A1–C2), emails the result and pre-fills the application. |
| Apply `/apply.html` | Online application with proof-of-payment upload. |
| Track application `/status.html` | Applicants check progress with their reference and email. |
| Goethe & official exams `/exams.html` | Registration for Goethe, ÖSD, telc, DELF … sessions. |
| Verify a certificate `/verify.html` | Employers, universities and embassies confirm a certificate is genuine. |
| Library `/library.html` | Books and materials; some can be limited to enrolled students. |

### Portals
| Portal | Highlights |
|---|---|
| **Student** | Dashboard, classes (with online-class links), assignments (hand in text or files), timed online exams marked instantly, results and CEFR skills profile, printable report card, attendance, timetable (syncs to Google Calendar / phone), library, messages, fees with online payment reporting and receipts, certificates, official exam registration, scholarships, course feedback. |
| **Teacher** | Class rosters, one-click attendance, assignments, exam builder (multiple choice + open questions), marking queue, gradebook, CEFR assessments, class announcements and notifications. |
| **Accounts** | Live payment-verification queue, receipts, invoices (single or a whole class at once), fee structures, student statements, debtors with reminders, exam fees, reports. |
| **HR** | Staff, teachers and students, adding users (automatic IDs and temporary passwords), password resets, leave approvals, attendance records. |
| **Director** | Executive dashboard, analytics (growth, admissions funnel, enquiry conversion), revenue, courses and classes, certificates, calendar, homepage content, institution settings, audit log. |
| **Admin** | Everything above, plus applications, enquiries, placement results, all website content, apps and integrations, webhooks. |

Everyone gets realtime notifications and messages, a searchable directory, profile editing, dark mode and an "Apps" page for tools such as Google Classroom.

Automatic background jobs (every 10 minutes): overdue invoices, fee reminders (3 days before and weekly while overdue), assignment and exam reminders, enquiry follow-up reminders.

---

## Technology

| Part | Choice | Why |
|---|---|---|
| Server | **Python 3.12, FastAPI** (async) | Fast, handles many users at once, easy to read and extend. |
| Database | **PostgreSQL** (Supabase free tier) — SQLite for local work | Reliable and always on; the same code runs on both. |
| Realtime | WebSockets | Instant notifications, messages and new-application alerts. |
| Frontend | Plain HTML, CSS and JavaScript — no framework, no build step | Tiny downloads (≈40 KB per page, compressed), works on older phones, nothing to compile. |
| Files | Any S3-compatible storage (Supabase Storage, Backblaze B2, Cloudflare R2) | Change provider by changing four settings. |
| Email | Any SMTP service (Brevo recommended) | 300 free emails per day. |
| Hosting | Render (free web service) | Deploys automatically from GitHub; runs WebSockets and background jobs. |

**Why not Vercel?** Vercel runs code as short-lived serverless functions. They cannot keep WebSocket connections open or run the reminder scheduler, so realtime updates and automatic reminders would stop working. **Neon** works as a database too (set its connection string as `DATABASE_URL`), but its free tier sleeps and limits compute hours; Supabase's free database stays on.

Because everything is standard (Docker, PostgreSQL, S3, SMTP), moving to another host later — for example a small paid server — is a configuration change, not a rewrite.

---

## Running it on your computer

Requirements: Python 3.12 or newer.

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env               # set ADMIN_PASSWORD in .env
python -m app.seed demo            # optional: demo teachers, students, classes, invoices, an exam
uvicorn app.main:app --reload
```

Open http://localhost:8000 and sign in as `ADMIN-001` with the password from `.env`.
Demo accounts (password `demo12345`): teacher `HMLI-STF-0001`, accounts `HMLI-STF-0003`, HR `HMLI-STF-0004`, director `HMLI-STF-0005`, students `HMLI-2026-0001` to `0010`.

Run the tests with `pytest`. Interactive API documentation is at `/api/docs`.

---

## Going live (free hosting)

All services below have free plans that do not ask for a credit card (at the time of writing — check when you sign up). Use the same email for all of them.

### 1. Database and file storage — Supabase
1. Create a **new** project at [supabase.com](https://supabase.com) (region: *Central EU (Frankfurt)*). Keep the old project until the move is finished.
2. **Database:** *Project Settings → Database → Connection string → Session pooler*. Copy it and replace `[YOUR-PASSWORD]`. This is `DATABASE_URL`.
3. **Storage:** *Storage → New bucket* named `heimatliebe`, **private**.
4. **Storage keys:** *Storage → Settings → S3 Connection → New access key*. Note:
   - `S3_ENDPOINT` = the endpoint shown (`https://<ref>.supabase.co/storage/v1/s3`)
   - `S3_REGION` = the region shown (e.g. `eu-central-1`)
   - `S3_BUCKET` = `heimatliebe`, and the access key ID / secret.

> Need more than 1 GB of files later? Create a free Backblaze B2 bucket (10 GB), change the four `S3_*` settings, and copy the files across (for example with `rclone`).

### 2. Email — Brevo
1. Sign up at [brevo.com](https://www.brevo.com), then *Senders & IP → Senders* and verify the address you send from.
2. *SMTP & API → SMTP → Generate a new SMTP key*. `SMTP_USER` is the login shown there, `SMTP_PASS` is the key.

### 3. The website — Render
1. Sign in to [render.com](https://render.com) with GitHub and allow access to this repository.
2. *New → Blueprint*, pick this repository. Render reads `render.yaml` and creates **heimatliebe** (production, from `main`) and **heimatliebe-staging** (from `staging`).
3. Fill in the values it asks for: `DATABASE_URL`, `SITE_URL` (e.g. `https://heimatliebe.onrender.com`), `ADMIN_PASSWORD`, `ADMIN_EMAIL`, the `SMTP_*` and `S3_*` values. `SECRET_KEY` is generated for you. Leave the Google values empty unless you set that up (see [Integrations](#integrations)).
4. When the deploy finishes, sign in as `ADMIN-001` with `ADMIN_PASSWORD` and change the password.

The production service refuses to start if the database, secret key or file storage is missing — that protects you from losing data by accident.

### 4. Keep it fast — UptimeRobot
Free Render services sleep after 15 minutes without visitors; the first visit then takes about 30 seconds. Create a free [UptimeRobot](https://uptimerobot.com) HTTP monitor for `https://<your-site>/api/health` every 5 minutes. It keeps the site (and the database) awake, keeps the reminders running, and emails you if the site ever goes down. Do **not** add a monitor for staging; it only needs to run while you test.

### 5. Your own domain (optional)
In Render: *Settings → Custom Domains*. Add the DNS records it shows at your domain provider, then update `SITE_URL`.

### 6. Move the data from the old site
With the **old** project's details, run once from your computer:
```bash
SUPABASE_URL=https://<old-ref>.supabase.co SUPABASE_SERVICE_KEY=<old service role key> \
DATABASE_URL="<new Session pooler connection string>" python -m app.migrate_supabase
```
It copies users (existing passwords keep working), applications, courses, news, library, gallery, documents, testimonials, scholarships, alumni and payments. Running it twice is safe.

---

## Working with `staging` and `main`

* **`main`** is the live website. Render deploys every push to `main`.
* **`staging`** is your test site. Every push to `staging` deploys to the staging service, which starts with fresh demo data every time (sign in with the demo accounts above, or `ADMIN-001` / `staging-admin-123`).

Adding a feature:
```bash
git checkout staging
git pull
# … make and commit your changes …
git push                       # tests run on GitHub and staging redeploys — check it in the browser
# When it works, open a pull request from staging to main on GitHub and merge it.
```
Every push and pull request runs the tests (`.github/workflows/ci.yml`); a red cross on GitHub means something broke.

To make GitHub **block** merges into `main` until the tests pass: *Settings → Branches → Add branch protection rule* for `main`, tick *Require a pull request before merging* and *Require status checks to pass* (choose **test**). On a private repository this needs GitHub Pro or a public repository.

---

## Managing the website content

Everything is managed from the **Admin portal** (directors can edit the homepage and settings too):

| What | Where |
|---|---|
| Homepage text (headline, about, goals, languages, vision, contact details, social links) | *Website → Homepage content* |
| News, library, gallery, downloads, testimonials | *Website* section |
| Courses shown on the website | *Academic → Courses* (untick *Show on the website* to hide) |
| Official exam sessions on `/exams.html` | *Academic → Official exams* |
| Institute name, currency, term, pass mark, applications open/closed | *System → Institution settings* |
| Tools in everyone's *Apps* page | *System → Apps & integrations* |

Photos are resized and compressed automatically when uploaded.

---

## Integrations

* **Google Workspace**
  * *Sign in with Google*: create an OAuth client (Google Cloud Console → APIs & Services → Credentials → *OAuth client ID*, type *Web application*, authorised redirect URI `https://<your-site>/api/auth/google/callback`). Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and optionally `GOOGLE_WORKSPACE_DOMAIN` to accept only institute accounts. Only people who already have an account (matched by email) can sign in.
  * *Google Calendar*: every user has a private calendar link (profile page and timetable) with their classes, exams and deadlines.
  * *Classroom, Drive, Docs, Forms, Meet*: add them under *Apps & integrations*. Google Docs, Slides, Forms, Drive files and YouTube videos can be opened inside the portal. Teachers can paste Google Docs/Drive links as assignment material, and online classes can use Google Meet links.
* **Learning platforms (Moodle, H5P, Kahoot, Quizlet …)**: add them as apps; embeddable ones open inside the portal. Running Moodle itself needs its own PHP server, so it is linked rather than hosted here.
* **Automation (Zapier, Make, n8n, Google Apps Script)**: *System → Webhooks*. Events such as new applications, confirmed payments and issued certificates are sent as JSON, signed with `X-Heimatliebe-Signature: sha256=<HMAC of the body>`.
* **API**: every screen uses the documented API at `/api/docs`.

---

## Security

* Passwords are hashed with bcrypt. Sign-in uses an httpOnly, SameSite session cookie that is invalidated when the password changes. Temporary passwords must be changed at first sign-in.
* Every table has explicit rules for who may read and change which rows and columns (`app/rest.py`): students only see their own records, teachers only their own classes, and password hashes are never sent out.
* A strict Content-Security-Policy allows only the site's own scripts. Cross-site form posts are rejected, and security headers and HSTS are set.
* Failed sign-ins are limited per account and per network, so a computer lab sharing one connection is never locked out. Public forms are rate-limited.
* Uploads are checked by type and size. Payment proofs and submissions are private and only visible to staff and their owner. Photos are stripped of location data.
* Changes are recorded in the audit log. Production refuses to start without a database, secret key and file storage.

---

## Performance

* About 40 KB (compressed) to open the homepage or a portal. A service worker then serves the app shell from the device, so repeat visits are instant and pages already seen work offline.
* System fonts, an SVG icon sprite, CSS-only charts and lazy-loaded images. Animations use only transform and opacity and switch off for users who prefer reduced motion.
* Dashboards come from a single request each. Lists are paginated and searched on the server. Statistics are calculated by the database.
* A load test (`scripts/loadtest.py`, 3,000 students with 60,000 attendance records, 300 students signing in within about 25 seconds) completed with no errors. Most requests take 1–20 ms on the server.

---

## Project structure

```
app/                    Python server
  main.py               start-up, security headers, routing, static files
  config.py             settings from environment variables (see .env.example)
  models.py             database tables
  rest.py               data API with per-role access rules
  routers/              auth, public, academics, finance, messaging, admin, integrations, system
  security.py           passwords, sessions, roles, rate limits, audit log
  storage.py            file uploads (local disk or S3-compatible storage)
  realtime.py           WebSocket notifications
  webhooks.py           outgoing webhooks
  tasks.py              background reminders
  services.py           shared business logic and settings defaults
  placement_bank.py     placement test questions
  seed.py               first-run admin, starter content, demo data
  migrate_supabase.py   one-time import from the old site
content/                starter website content (Markdown), imported on first start
public/                 everything the browser downloads
  css/app.css           design system for portals
  css/site.css          public website layout
  js/api.js, ui.js      API client and UI helpers
  js/portal.js          portal shell (menu, notifications, realtime)
  js/components.js      tables, forms, chat, timetable, calendar
  js/management.js      director/admin screens
  js/portals/*.js       one file per portal
  js/pages/*.js         one file per public page
  img/icons.svg         icon set
tests/                  automated tests
scripts/loadtest.py     performance test
render.yaml             hosting blueprint (production + staging)
```

---

## Maintenance guide

* **Add a portal page**: add an entry to the `nav` list and a function to `pages` in `public/js/portals/<role>.js`. Most admin screens are a `crudPage({...})` configuration (see `public/js/components.js`).
* **Add a database field**: add it to the model in `app/models.py`, add it to the form fields in the portal file, and add it to the table's `writable` list in `app/rest.py` if only some roles may change it. New tables are created automatically. For new columns on an existing production database, add them in the Supabase SQL editor (`ALTER TABLE … ADD COLUMN …`).
* **Change who can see or edit something**: edit the table's `Policy` in `app/rest.py`, then add a test in `tests/`.
* **Placement test questions**: `app/placement_bank.py`.
* **Emails**: `app/mailer.py` (layout) and the routers that send them.
* **After changing CSS or JavaScript**: bump `VERSION` in `public/sw.js` so every browser refreshes its offline copy.
* **Backups**: Supabase's free plan has no automatic backups you can download. Export the database regularly (*Database → Backups*, or `pg_dump` with the connection string) and keep a copy of the storage bucket.

## Licence
[GNU AGPL v3](LICENSE)
