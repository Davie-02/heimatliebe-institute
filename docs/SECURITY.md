# Security

## Signing in

- **One sign-in page** for students and staff (`/sign-in`). The password is checked against both kinds of account with the same amount of work, and wrong emails and wrong passwords get the same answer, so the page can't be used to find out who has an account.
- **System administrators** sign in only at `/admin/login`, must use two-step verification, never get "keep me signed in", and can optionally be limited to listed network addresses.
- **Two-step verification** (authenticator app, RFC 6238) for any staff member, with eight single-use recovery codes. Each code works once, so an observed code can't be replayed.
- **Lockout**: five wrong passwords or codes lock the account for 15 minutes — also for emails that have no account, so the lockout reveals nothing. Sign-in and form endpoints are also rate-limited per network address.
- **Passwords**: at least 10 characters with upper and lower case letters and a number; common passwords and the person's own name are refused. Stored with bcrypt (cost 12).
- **Invitations**: new staff get a 20-character one-time password (valid 72 hours) and must choose their own at first sign-in. New students get a one-time link to choose their password (valid 7 days). Reset links last one hour and work once.
- **Continue with Google / Facebook** only signs in an existing account with the same verified email. Google's token is verified against Google's published keys and must be issued for this website.
- **Sessions** are signed tokens in an HttpOnly cookie. Signing out cancels the token itself; changing a password, "sign out everywhere", deactivation or an access change end other sessions immediately. A new sign-in to a staff account triggers an alert email.
- **Confirm it's you**: changing someone's access, creating administrators or resetting someone's two-step verification asks for the password (and code) again, valid for 10 minutes.

## Requests

- **CSRF**: any request that changes something while a session cookie is present must carry a signed anti-forgery token.
- **CORS** allows only the website's address. Security headers are set on both the API (Helmet) and the website (`vercel.json`: strict Content-Security-Policy, HSTS, no framing).
- **Validation**: every request body is checked against an allow-list of fields and types; unknown fields are refused. Record types can only be changed through the fields listed in `server/src/resources/registry.ts`.
- **Access** is decided on the server for every request (see `server/src/access/route-access.ts`); what the website hides is only for convenience.

## Files

- The file's real type is checked from its content, not its name; only photos, PDFs, Office documents and audio/video are accepted (10 MB by default).
- Photos are re-encoded (which also removes GPS location and other hidden data).
- Private files (homework, payment proofs) are served only to staff and the student who uploaded them, with a locked-down content policy so a file can never run as a web page.
- Spreadsheet exports neutralise cells that would run as formulas.

## Personal data

- Public pages expose only fields explicitly marked public for published records.
- The website assistant never receives personal records; questions are stored for 90 days with emails and phone numbers removed.
- Every change by staff is recorded in the activity log.

## Reporting a problem

Please report security issues privately to the institute's system administrator rather than in a public issue.
