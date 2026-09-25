import { Injectable, Logger } from "@nestjs/common";

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

export type EmailProvider = "resend" | "brevo" | "none";

export interface SendResult {
  ok: boolean;
  /** Human-readable reason when it didn't go through. */
  error?: string;
}

function parseAddress(from: string): { name?: string; email: string } {
  const match = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return match ? { name: match[1].trim() || undefined, email: match[2].trim() } : { email: from.trim() };
}

/**
 * Sends email through Brevo or Resend. Both are plain HTTPS APIs — important, because free
 * hosting such as Render blocks the normal SMTP ports. Chosen by EMAIL_PROVIDER, or automatically
 * from whichever API key is set.
 *
 * - Brevo (recommended, free 300/day): can send from a single verified sender address, no domain needed.
 * - Resend: needs a verified domain to email anyone but the account owner.
 *
 * Not configured = every send logs a warning and returns { ok: false }, so local development never
 * needs an email account. Sending never throws: an email problem must not break the request that caused it.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private warnedReplyTo = false;

  get provider(): EmailProvider {
    const choice = (process.env.EMAIL_PROVIDER ?? "").toLowerCase();
    if (choice === "brevo" && process.env.BREVO_API_KEY) return "brevo";
    if (choice === "resend" && process.env.RESEND_API_KEY) return "resend";
    if (!choice) {
      if (process.env.BREVO_API_KEY) return "brevo";
      if (process.env.RESEND_API_KEY) return "resend";
    }
    return "none";
  }

  get isConfigured(): boolean {
    return this.provider !== "none";
  }

  get fromAddress(): string {
    return process.env.EMAIL_FROM || "Heimatliebe Institute <no-reply@heimatliebe.mw>";
  }

  /** Replies go here (e.g. the institute inbox) even if the sending address is a no-reply. */
  get replyTo(): string | undefined {
    const raw = (process.env.EMAIL_REPLY_TO ?? "").trim().replace(/^["']+|["']+$/g, "");
    if (!raw) return undefined;
    const { email } = parseAddress(raw);
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
      if (!this.warnedReplyTo) {
        this.warnedReplyTo = true;
        this.logger.warn(`EMAIL_REPLY_TO ("${raw}") isn't a valid email address, so it is being ignored.`);
      }
      return undefined;
    }
    return email;
  }

  /** Where "new application" style notices for the office go. */
  get officeInbox(): string | undefined {
    return process.env.OFFICE_NOTIFICATION_EMAIL || undefined;
  }

  /** Fire-and-forget: never throws. */
  async send(input: SendEmailInput): Promise<void> {
    await this.sendChecked(input);
  }

  /** Like send(), but tells the caller whether it worked (used for staff-initiated emails and the test button). */
  async sendChecked({ to, subject, html }: SendEmailInput): Promise<SendResult> {
    const provider = this.provider;
    if (provider === "none") {
      this.logger.warn(`No email provider configured — skipping "${subject}" to ${to}. Set BREVO_API_KEY (or RESEND_API_KEY).`);
      return { ok: false, error: "Email isn't connected yet. A system administrator can see what's needed under System → System status." };
    }
    try {
      const response = provider === "brevo" ? await this.sendBrevo(to, subject, html) : await this.sendResend(to, subject, html);
      if (!response.ok) {
        const body = await response.text();
        this.logger.error(`${provider} API error (${response.status}) sending "${subject}": ${body.slice(0, 300)}`);
        return { ok: false, error: this.explain(provider, response.status, body) };
      }
      return { ok: true };
    } catch (error) {
      this.logger.error(`Failed to send "${subject}"`, error as Error);
      return { ok: false, error: "Couldn't reach the email service." };
    }
  }

  async notifyOffice(subject: string, html: string): Promise<void> {
    if (this.officeInbox) await this.send({ to: this.officeInbox, subject, html });
  }

  private sendResend(to: string, subject: string, html: string) {
    return fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.fromAddress, to, subject, html, ...(this.replyTo ? { reply_to: this.replyTo } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
  }

  private sendBrevo(to: string, subject: string, html: string) {
    return fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": process.env.BREVO_API_KEY as string, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: parseAddress(this.fromAddress),
        to: [{ email: to }],
        subject,
        htmlContent: html,
        ...(this.replyTo ? { replyTo: { email: this.replyTo } } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
  }

  private explain(provider: EmailProvider, status: number, body: string): string {
    let detail = "";
    try {
      const parsed = JSON.parse(body) as { message?: string; error?: { message?: string } };
      detail = parsed.message ?? parsed.error?.message ?? "";
    } catch {
      detail = body.slice(0, 200);
    }
    if (status === 401 || status === 403) return `The ${provider} API key was rejected${detail ? ` (${detail})` : ""}. Check the key in ${provider}.`;
    if (provider === "brevo" && /sender/i.test(detail)) return `Brevo doesn't accept the sending address. Verify EMAIL_FROM as a sender in Brevo. (${detail})`;
    if (provider === "resend" && /verify|domain/i.test(detail || body)) return "Resend only delivers to your own address until a domain is verified. Verify your domain or use Brevo.";
    return `The email service refused the message${detail ? `: ${detail}` : ` (HTTP ${status})`}.`;
  }
}
