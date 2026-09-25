import { applicationReceivedEmail, escapeHtml, staffInvitationEmail } from "./templates";

describe("email templates", () => {
  it("escapes everything people typed", () => {
    expect(escapeHtml(`<script>"x"</script>`)).toBe("&lt;script&gt;&quot;x&quot;&lt;/script&gt;");
    const { html } = applicationReceivedEmail({ name: "<b>Eve</b>", reference: "APP-1", course: "German", trackUrl: "https://x.test/t" });
    expect(html).not.toContain("<b>Eve</b>");
    expect(html).toContain("&lt;b&gt;Eve&lt;/b&gt;");
  });

  it("includes the one-time password in invitations", () => {
    const { html, subject } = staffInvitationEmail({ name: "Ana", email: "ana@x.test", tempPassword: "Tmp-Pass-123", signInUrl: "https://x.test/sign-in", invitedBy: "Director" });
    expect(subject).toContain("staff account");
    expect(html).toContain("Tmp-Pass-123");
  });
});
