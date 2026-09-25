import { useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Empty, ErrorNote, Loading, Modal, PageHead, TextArea, TextField } from "@/components/ui";
import { FileField } from "@/components/FileField";
import { RichText } from "@/components/RichText";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/Toasts";
import { useAuth } from "@/context/AuthContext";
import { useData, usePageMeta } from "@/hooks/useData";
import { api } from "@/services/api";
import { date, money } from "@/lib/format";
import { LibraryGrid, type LibraryItem } from "../site/Library";

export function Library() {
  const { data, loading } = useData<LibraryItem[]>("/me/library", ["library"]);
  usePageMeta("Library");
  return (
    <>
      <PageHead title="Library" description="Everything in the institute's library, including material for students only." />
      {loading ? <Loading /> : <LibraryGrid items={data ?? []} />}
    </>
  );
}

interface Scholarship { id: string; title: string; description: string | null; criteria: string | null; amount: number | null; deadline: string | null; application: { status: string; createdAt: string } | null }

export function Scholarships() {
  const { data, loading, reload } = useData<Scholarship[]>("/me/scholarships", ["scholarships", "scholarship-applications"]);
  const [applying, setApplying] = useState<Scholarship | null>(null);
  usePageMeta("Scholarships");
  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="Scholarships" />
      {data?.length ? (
        <div className="grid-2">
          {data.map((s) => (
            <article key={s.id} className="card stack">
              <h3 style={{ margin: 0 }}>{s.title}</h3>
              <p className="muted small" style={{ margin: 0 }}>{s.amount ? money(s.amount) : ""}{s.deadline ? ` · apply by ${date(s.deadline)}` : ""}</p>
              <RichText className="small" text={s.description} />
              {s.criteria && <p className="small"><strong>Who can apply:</strong> {s.criteria}</p>}
              {s.application ? <span className="badge badge-info">Applied {date(s.application.createdAt)} · {s.application.status}</span> : <Button onClick={() => setApplying(s)}>Apply</Button>}
            </article>
          ))}
        </div>
      ) : <div className="card"><Empty icon="gift" title="No scholarships are open right now" /></div>}
      {applying && <ApplyScholarship scholarship={applying} onClose={() => setApplying(null)} onDone={() => { setApplying(null); void reload(); }} />}
    </>
  );
}

function ApplyScholarship({ scholarship, onClose, onDone }: { scholarship: Scholarship; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/me/scholarships/${scholarship.id}/apply`, { statement });
      toast("Application sent.");
      onDone();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Apply: ${scholarship.title}`} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorNote error={error} />
        <TextArea label="Why should you receive this scholarship?" required rows={8} value={statement} onChange={(e) => setStatement(e.target.value)} />
        <div className="form-actions"><Button type="submit" loading={busy} disabled={statement.trim().length < 20}>Send application</Button></div>
      </form>
    </Modal>
  );
}

interface App { id: string; name: string; url: string; description: string | null; icon: string; embed: boolean }

export function Apps() {
  const { data, loading } = useData<App[]>("/me/apps", ["apps"]);
  const [embedded, setEmbedded] = useState<App | null>(null);
  usePageMeta("Apps & links");
  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="Apps & links" description="Tools the institute uses, such as Google Classroom and online lessons." />
      {data?.length ? (
        <div className="grid">
          {data.map((app) =>
            app.embed ? (
              <button key={app.id} className="tile" style={{ textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer" }} onClick={() => setEmbedded(app)}>
                <span className="tile-icon"><Icon name={app.icon} /></span><h3>{app.name}</h3><p>{app.description}</p>
              </button>
            ) : (
              <a key={app.id} className="tile" href={app.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", color: "inherit" }}>
                <span className="tile-icon"><Icon name={app.icon} /></span><h3>{app.name} <Icon name="external" /></h3><p>{app.description}</p>
              </a>
            )
          )}
        </div>
      ) : <div className="card"><Empty icon="grid" title="No apps added yet" /></div>}
      {embedded && (
        <Modal title={embedded.name} onClose={() => setEmbedded(null)} wide>
          <iframe src={embedded.url} title={embedded.name} style={{ width: "100%", height: "70dvh", border: 0, borderRadius: 12 }} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
          <a href={embedded.url} target="_blank" rel="noopener noreferrer" className="small">Open in a new tab</a>
        </Modal>
      )}
    </>
  );
}

interface Announcement { id: string; title: string; body: string | null; pinned: boolean; createdAt: string }

export function Announcements() {
  const { data, loading } = useData<Announcement[]>("/me/announcements", ["announcements"]);
  usePageMeta("Announcements");
  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="Announcements" />
      {data?.length ? (
        <div className="stack">
          {data.map((a) => (
            <article key={a.id} className="card">
              <div className="row-between"><h3 style={{ margin: 0 }}>{a.pinned && <Icon name="pin" />} {a.title}</h3><span className="muted small">{date(a.createdAt)}</span></div>
              <RichText className="muted" text={a.body} />
            </article>
          ))}
        </div>
      ) : <div className="card"><Empty icon="megaphone" title="No announcements" /></div>}
    </>
  );
}

interface ProfileData { studentNo: string; name: string; email: string; phone: string | null; address: string | null; guardianName: string | null; guardianPhone: string | null; photoUrl: string | null; course: string | null; level: string | null; status: string; dateOfBirth: string | null }

export function Profile() {
  const { refresh } = useAuth();
  const toast = useToast();
  const { data, loading } = useData<ProfileData>("/me/profile");
  const [form, setForm] = useState({ phone: "", address: "", guardianName: "", guardianPhone: "" });
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  usePageMeta("My details");
  useEffect(() => {
    if (data) {
      setForm({ phone: data.phone ?? "", address: data.address ?? "", guardianName: data.guardianName ?? "", guardianPhone: data.guardianPhone ?? "" });
      setPhoto(data.photoUrl);
    }
  }, [data]);
  if (loading || !data) return <Loading />;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.patch("/me/profile", { ...form, photoUrl: photo ?? "" });
      await refresh();
      toast("Saved.");
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHead title="My details" />
      <div className="grid-2">
        <section className="card">
          <h2>{data.name}</h2>
          <ul className="list small">
            <li><span>Student number</span><strong className="mono">{data.studentNo}</strong></li>
            <li><span>Email</span><span>{data.email}</span></li>
            <li><span>Course</span><span>{data.course ?? "—"}</span></li>
            <li><span>Level</span><span>{data.level ?? "—"}</span></li>
            <li><span>Date of birth</span><span>{date(data.dateOfBirth)}</span></li>
          </ul>
          <Alert>To change your name, email or course, please contact the office.</Alert>
        </section>
        <form className="card" onSubmit={submit}>
          <h2>Contact details</h2>
          <ErrorNote error={error} />
          <FileField label="Photo" value={photo} onChange={setPhoto} realm="student" accept="image/*" />
          <TextField label="Phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <TextArea label="Address" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <div className="form-grid">
            <TextField label="Guardian name" value={form.guardianName} onChange={(e) => setForm({ ...form, guardianName: e.target.value })} />
            <TextField label="Guardian phone" type="tel" value={form.guardianPhone} onChange={(e) => setForm({ ...form, guardianPhone: e.target.value })} />
          </div>
          <div className="form-actions"><Button type="submit" loading={busy}>Save</Button></div>
        </form>
      </div>
    </>
  );
}
