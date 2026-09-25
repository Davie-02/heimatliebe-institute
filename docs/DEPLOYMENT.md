# Deployment

Everything runs on free plans that don't need a credit card. Set it up once; afterwards every
push to `staging` or `main` deploys by itself.

## 1. Database — Neon

1. Create a project at <https://neon.tech> (region: Frankfurt, closest to Render's).
2. On the project dashboard choose **Connect** and copy two connection strings:
   - **Pooled** (host contains `-pooler`) → `DATABASE_URL`
   - **Direct** (without `-pooler`) → `DIRECT_URL`
   Both end with `?sslmode=require`.
3. For staging, create a **branch** (Branches → New branch, e.g. `staging`) and copy its two strings too. Staging never touches live data.

## 2. File storage — Backblaze B2 (or Cloudflare R2)

1. At <https://www.backblaze.com/b2> create a **private** bucket, e.g. `heimatliebe-files`.
2. Application Keys → Add a key with read and write access to that bucket.
3. Note: bucket name → `S3_BUCKET`, endpoint (e.g. `https://s3.eu-central-003.backblazeb2.com`) → `S3_ENDPOINT`, region (e.g. `eu-central-003`) → `S3_REGION`, key ID → `S3_ACCESS_KEY_ID`, application key → `S3_SECRET_ACCESS_KEY`.

Files are served through the API, so the bucket stays private; homework and payment proofs are only shown to staff and the student who uploaded them. Photos are converted to compact WebP images on upload.

## 3. Email — Brevo

1. Sign up at <https://www.brevo.com>. Senders & IPs → **Senders** → add and verify the address emails come from (e.g. `heimatliebemw@gmail.com`).
2. SMTP & API → **API keys** → create a key → `BREVO_API_KEY`.
3. `EMAIL_FROM` = `Heimatliebe Institute <heimatliebemw@gmail.com>` (the verified address). Optional: `OFFICE_NOTIFICATION_EMAIL` receives a note for each new application and enquiry.

(The API uses Brevo's HTTPS API because Render's free plan blocks the usual email ports.)

## 4. API — Render

1. At <https://render.com> choose **New → Blueprint**, connect the GitHub repository. Render reads `render.yaml` and creates `heimatliebe-api` (branch `main`) and `heimatliebe-api-staging` (branch `staging`).
2. Fill in the values it asks for (see comments in `render.yaml`). The important ones:
   - `DATABASE_URL`, `DIRECT_URL` from Neon (the staging branch's strings for staging)
   - `FRONTEND_URL` — the website's address from step 5 (you can come back and set it)
   - `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` — the first system administrator. The password needs 10+ characters with upper and lower case letters and a number. Remove `ADMIN_PASSWORD` after the first sign-in.
   - `BREVO_API_KEY`, `EMAIL_FROM`, and the `S3_*` values
3. The first deploy creates the tables. The live site starts with the institute's own starter content (the Beginner German course, the Goethe exam notice and a few FAQs); staging loads demo data.

The free plan sleeps after 15 minutes without visitors, and the first request afterwards takes about a minute. To keep it awake during office hours, add a free monitor at <https://uptimerobot.com> that opens `https://heimatliebe-api.onrender.com/api/health` every 10 minutes.

## 5. Website — Vercel

1. At <https://vercel.com> **Add New → Project**, import the repository. Framework: Vite (detected). No settings needed.
2. If your API's address differs from `https://heimatliebe-api.onrender.com`, change it in `vercel.json` (it appears in the rewrites and in the Content-Security-Policy `connect-src`).
3. After the first deploy, copy the site's address into `FRONTEND_URL` on Render.

**Why the website forwards `/api`:** the browser talks to the API through the website's own address, so the sign-in cookie is "first-party" and works in every browser, including Safari and phones that block third-party cookies.

**Staging website:** Vercel makes a preview deployment for every push to `staging`. In Vercel → Settings → Environment Variables, add for the **Preview** environment:

| Name | Value |
|---|---|
| `VITE_DIRECT_API` | `true` |
| `VITE_API_BASE_URL` | `https://heimatliebe-api-staging.onrender.com/api` |

and put the preview address (e.g. `https://heimatliebe-git-staging-<you>.vercel.app`) in `FRONTEND_URL` of the staging API.

**Your own domain:** in Vercel → Domains add e.g. `heimatliebe.mw`, then update `FRONTEND_URL` on Render.

## 6. Optional extras

| Feature | Setting |
|---|---|
| Website assistant | Free key from <https://aistudio.google.com/apikey> → `GEMINI_API_KEY` |
| Continue with Google | Google Cloud Console → Credentials → OAuth client (Web), authorised JavaScript origin = the website address → `GOOGLE_CLIENT_ID` |
| Continue with Facebook | <https://developers.facebook.com> → app with Facebook Login → `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` |
| Limit administrators to the office network | `SYSTEM_ADMIN_ALLOWED_IPS` = comma-separated addresses |

Social sign-in only signs in **existing** accounts with the same verified email; it never creates accounts.

## Checking everything works

Sign in as the administrator (`/admin/login`), set up two-step verification, then open **System → System status**. It shows whether email, storage, the assistant and social sign-in are connected, and has a button to send yourself a test email.

## Backups

Neon keeps a restore window (point-in-time restore) on the free plan. For an extra copy, use **Export** on any list in the workspace (spreadsheet) or run `pg_dump "$DIRECT_URL" > backup.sql` from a computer with PostgreSQL installed.
