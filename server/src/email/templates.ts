/**
 * Every email the system sends, in one place. Each function returns { subject, html }.
 * The layout is plain, table-free HTML that renders in every mail app, with the institute's colours.
 * All values from people (names, messages) are escaped.
 */

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const INSTITUTE = () => process.env.INSTITUTE_NAME || "Heimatliebe Institute";

function layout(title: string, body: string, action?: { label: string; url: string }): string {
  const button = action
    ? `<p style="margin:28px 0"><a href="${escapeHtml(action.url)}" style="background:#1b4332;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(action.label)}</a></p>
       <p style="font-size:12px;color:#5c6b66">If the button doesn't work, copy this address into your browser:<br>${escapeHtml(action.url)}</p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f5f4ef;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1f1c">
  <div style="max-width:560px;margin:0 auto;padding:28px 16px">
    <div style="font-weight:800;font-size:18px;color:#1b4332;margin-bottom:18px">${escapeHtml(INSTITUTE())}</div>
    <div style="background:#ffffff;border:1px solid #e4e2da;border-radius:12px;padding:28px 24px">
      <h1 style="font-size:20px;margin:0 0 14px">${escapeHtml(title)}</h1>
      <div style="font-size:15px;line-height:1.6">${body}</div>
      ${button}
    </div>
    <p style="font-size:12px;color:#5c6b66;margin-top:18px">${escapeHtml(INSTITUTE())} · Karonga, Malawi</p>
  </div></body></html>`;
}

const p = (text: string) => `<p style="margin:0 0 12px">${text}</p>`;

export function staffInvitationEmail(input: { name: string; email: string; tempPassword: string; signInUrl: string; invitedBy: string }) {
  return {
    subject: `Your ${INSTITUTE()} staff account`,
    html: layout(
      `Welcome, ${input.name}`,
      p(`${escapeHtml(input.invitedBy)} has created a staff account for you.`) +
        p(`Sign in with your email <strong>${escapeHtml(input.email)}</strong> and this one-time password:`) +
        `<p style="font-family:ui-monospace,Menlo,monospace;font-size:17px;background:#f5f4ef;padding:10px 14px;border-radius:8px;letter-spacing:.04em">${escapeHtml(input.tempPassword)}</p>` +
        p("You'll choose your own password straight away. The one-time password stops working after 72 hours."),
      { label: "Sign in", url: input.signInUrl }
    ),
  };
}

export function studentInvitationEmail(input: { name: string; studentNo: string; url: string }) {
  return {
    subject: `Your ${INSTITUTE()} student portal`,
    html: layout(
      `Welcome, ${input.name}`,
      p(`Your student number is <strong>${escapeHtml(input.studentNo)}</strong>.`) +
        p("Choose a password to open your student portal, where you'll find your classes, timetable, assignments, results and fees. The link works for 7 days."),
      { label: "Choose my password", url: input.url }
    ),
  };
}

export function passwordResetEmail(url: string) {
  return {
    subject: "Reset your password",
    html: layout(
      "Reset your password",
      p("Someone asked to reset the password for this account. If it was you, use the button below. The link works for one hour.") +
        p("If it wasn't you, ignore this email — your password stays the same."),
      { label: "Choose a new password", url }
    ),
  };
}

export function passwordChangedEmail(name: string) {
  return {
    subject: "Your password was changed",
    html: layout(
      "Password changed",
      p(`Hello ${escapeHtml(name)}, the password for your account was just changed and other devices were signed out.`) +
        p("If this wasn't you, reset your password immediately and tell the office.")
    ),
  };
}

export function signInAlertEmail(input: { name: string; when: Date; ip: string; device: string; securityUrl: string }) {
  return {
    subject: "New sign-in to your staff account",
    html: layout(
      "New sign-in",
      p(`Hello ${escapeHtml(input.name)}, your account was just used to sign in.`) +
        p(`<strong>When:</strong> ${escapeHtml(input.when.toUTCString())}<br><strong>Device:</strong> ${escapeHtml(input.device)}<br><strong>Network address:</strong> ${escapeHtml(input.ip)}`) +
        p("If this wasn't you, change your password and choose “Sign out everywhere”."),
      { label: "Review my security", url: input.securityUrl }
    ),
  };
}

export function applicationReceivedEmail(input: { name: string; reference: string; course: string; trackUrl: string }) {
  return {
    subject: `Application received – ${input.reference}`,
    html: layout(
      "We have your application",
      p(`Thank you, ${escapeHtml(input.name)}. We have received your application for <strong>${escapeHtml(input.course)}</strong>.`) +
        p(`Your reference is <strong>${escapeHtml(input.reference)}</strong>. Keep it to check your application's progress.`),
      { label: "Track my application", url: input.trackUrl }
    ),
  };
}

export function applicationDecisionEmail(input: { name: string; reference: string; status: string; message?: string }) {
  const lines: Record<string, string> = {
    accepted: "Congratulations — you have been accepted. A separate email explains how to open your student portal.",
    waitlisted: "Your application is on our waiting list. We'll contact you as soon as a place opens.",
    rejected: "Unfortunately we can't offer you a place at this time.",
    reviewing: "Your application is now being reviewed.",
  };
  return {
    subject: `Your application ${input.reference}`,
    html: layout(
      "Application update",
      p(`Hello ${escapeHtml(input.name)},`) + p(lines[input.status] ?? `Your application status is now: ${escapeHtml(input.status)}.`) + (input.message ? p(escapeHtml(input.message)) : "")
    ),
  };
}

export function newApplicationOfficeEmail(input: { name: string; reference: string; course: string; url: string }) {
  return {
    subject: `New application: ${input.name}`,
    html: layout("New application", p(`${escapeHtml(input.name)} applied for ${escapeHtml(input.course)} (${escapeHtml(input.reference)}).`), { label: "Review it", url: input.url }),
  };
}

export function enquiryReceivedOfficeEmail(input: { name: string; interest?: string | null; message?: string | null; url: string }) {
  return {
    subject: `New enquiry from ${input.name}`,
    html: layout(
      "New enquiry",
      p(`<strong>${escapeHtml(input.name)}</strong>${input.interest ? ` asked about ${escapeHtml(input.interest)}` : ""}.`) + (input.message ? p(escapeHtml(input.message)) : ""),
      { label: "Open enquiries", url: input.url }
    ),
  };
}

export function examRegistrationEmail(input: { name: string; title: string; date: string }) {
  return {
    subject: `Registration received – ${input.title}`,
    html: layout(
      "Exam registration received",
      p(`Thank you, ${escapeHtml(input.name)}. We have your registration for <strong>${escapeHtml(input.title)}</strong> on ${escapeHtml(input.date)}.`) +
        p("We'll confirm your place once your payment has been checked.")
    ),
  };
}

export function paymentConfirmedEmail(input: { name: string; amount: string; receiptNo: string; url: string }) {
  return {
    subject: `Payment received – receipt ${input.receiptNo}`,
    html: layout(
      "Payment confirmed",
      p(`Hello ${escapeHtml(input.name)}, we have confirmed your payment of <strong>${escapeHtml(input.amount)}</strong>.`) + p(`Receipt number: ${escapeHtml(input.receiptNo)}`),
      { label: "View my fees", url: input.url }
    ),
  };
}

export function feeReminderEmail(input: { name: string; invoiceNo: string; balance: string; dueDate: string; url: string }) {
  return {
    subject: `Fee reminder – ${input.invoiceNo}`,
    html: layout(
      "Friendly fee reminder",
      p(`Hello ${escapeHtml(input.name)}, invoice ${escapeHtml(input.invoiceNo)} has a balance of <strong>${escapeHtml(input.balance)}</strong>, due ${escapeHtml(input.dueDate)}.`) +
        p("If you have already paid, please upload your proof of payment in the portal."),
      { label: "View my fees", url: input.url }
    ),
  };
}

export function notificationEmail(input: { name: string; title: string; body?: string | null; url?: string }) {
  return {
    subject: input.title,
    html: layout(input.title, p(`Hello ${escapeHtml(input.name)},`) + (input.body ? p(escapeHtml(input.body)) : ""), input.url ? { label: "Open", url: input.url } : undefined),
  };
}

export function testEmail() {
  return { subject: `Test email from ${INSTITUTE()}`, html: layout("Email works", p("This test message shows that outgoing email is set up correctly.")) };
}
