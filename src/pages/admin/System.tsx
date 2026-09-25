import { Alert, Button, Loading, PageHead } from "@/components/ui";
import { useToast } from "@/components/Toasts";
import { useStaff } from "@/context/AuthContext";
import { useData, usePageMeta } from "@/hooks/useData";
import { can } from "@/admin/access";
import { api } from "@/services/api";
import { dateTime } from "@/lib/format";

interface Status { database: string; email: { provider: string; from: string; officeInbox: string | null }; storage: "bucket" | "local"; assistant: boolean; signIn: { google: boolean; facebook: boolean }; scheduler: boolean; liveConnections: number; environment: string; startedAt: string; version: string | null }

function Row({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return <li><span>{label}<br /><span className="muted small">{detail}</span></span><span className={`badge ${ok ? "badge-success" : "badge-warning"}`}>{ok ? "Working" : "Needs setup"}</span></li>;
}

/** What's connected and what still needs setting up (details in docs/DEPLOYMENT.md). */
export default function System() {
  const user = useStaff();
  const toast = useToast();
  const { data, loading, reload } = useData<Status>("/workspace/system-status");
  usePageMeta("System status");
  if (loading || !data) return <Loading />;
  async function testEmail() {
    const result = await api.post<{ ok: boolean; error?: string }>("/workspace/test-email");
    toast(result.ok ? `Test email sent to ${user.email}.` : result.error ?? "Couldn't send.", result.ok ? "success" : "error");
  }
  return (
    <>
      <PageHead title="System status" description={`${data.environment} · running since ${dateTime(data.startedAt)}${data.version ? ` · version ${data.version}` : ""}`} actions={<Button variant="outline" icon="refresh" onClick={() => void reload()}>Refresh</Button>} />
      {data.storage === "local" && data.environment === "production" && <Alert tone="danger">Uploads are stored on the server's disk and will be lost on the next deploy. Connect a storage bucket.</Alert>}
      <div className="grid-2">
        <section className="card">
          <ul className="list">
            <Row label="Database" ok={data.database === "ok"} detail={data.database === "ok" ? "Connected" : "Can't reach the database"} />
            <Row label="Email" ok={data.email.provider !== "none"} detail={data.email.provider !== "none" ? `${data.email.provider} · from ${data.email.from}` : "Set BREVO_API_KEY and EMAIL_FROM"} />
            <Row label="File storage" ok={data.storage === "bucket"} detail={data.storage === "bucket" ? "Storage bucket" : "Server disk (development only)"} />
            <Row label="Website assistant" ok={data.assistant} detail={data.assistant ? "Gemini connected" : "Set GEMINI_API_KEY to switch it on"} />
            <Row label="Sign in with Google" ok={data.signIn.google} detail={data.signIn.google ? "Enabled" : "Optional: set GOOGLE_CLIENT_ID"} />
            <Row label="Sign in with Facebook" ok={data.signIn.facebook} detail={data.signIn.facebook ? "Enabled" : "Optional: set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET"} />
            <Row label="Scheduled jobs" ok={data.scheduler} detail="Overdue invoices, fee reminders, FAQ suggestions" />
          </ul>
        </section>
        <section className="card">
          <h2>Right now</h2>
          <p><strong>{data.liveConnections}</strong> screens are connected for live updates.</p>
          <p className="muted small">Office notifications go to: {data.email.officeInbox ?? "not set (OFFICE_NOTIFICATION_EMAIL)"}</p>
          {can(user, "system", "manage") && <Button variant="outline" icon="mail" onClick={() => void testEmail()}>Send me a test email</Button>}
        </section>
      </div>
    </>
  );
}
