import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Avatar, Button, Empty, ErrorNote, Loading, Modal, PageHead, SelectField, Status, TextArea, TextField } from "@/components/ui";
import { FileField } from "@/components/FileField";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/Toasts";
import { useAuth, useStaff } from "@/context/AuthContext";
import { useData, usePageMeta } from "@/hooks/useData";
import { api } from "@/services/api";
import { date } from "@/lib/format";
import type { Paged } from "@/lib/types";

interface Leave { id: string; type: string; startDate: string; endDate: string; days: number; reason: string | null; status: string; reviewedBy: string | null; reviewNote: string | null }

/** My profile (phone, photo, short bio) and my leave. */
export default function MyAccount() {
  const user = useStaff();
  const { refresh } = useAuth();
  const toast = useToast();
  const leave = useData<Leave[]>("/hr/leave/me", ["leave-requests"]);
  const [profile, setProfile] = useState({ phone: "", bio: "" });
  const [photo, setPhoto] = useState<string | null>(user.photoUrl);
  const [requesting, setRequesting] = useState(false);
  const [busy, setBusy] = useState(false);
  usePageMeta("My work & leave");

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch("/workspace/profile", { ...Object.fromEntries(Object.entries(profile).filter(([, v]) => v)), photoUrl: photo ?? "" });
      await refresh();
      toast("Profile saved.");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function cancel(id: string) {
    try {
      await api.del(`/hr/leave/me/${id}`);
      toast("Request withdrawn.");
      void leave.reload();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <>
      <PageHead title="My work & leave" description={`${user.jobTitle ?? ""} · ${user.email}`} actions={<Button icon="umbrella" onClick={() => setRequesting(true)}>Request leave</Button>} />
      <div className="grid-2">
        <form className="card" onSubmit={saveProfile}>
          <h2>My profile</h2>
          <p className="muted small">Shown to colleagues in the team directory.</p>
          <FileField label="Photo" value={photo} onChange={setPhoto} accept="image/*" />
          <TextField label="Phone" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} placeholder="Leave empty to keep it" />
          <TextArea label="A line about you" value={profile.bio} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} placeholder="e.g. Teaches A2 and B1; ask me about Goethe exams." />
          <div className="form-actions"><Button type="submit" loading={busy}>Save</Button></div>
        </form>
        <section className="card">
          <h2>My leave</h2>
          {leave.loading ? <Loading /> : leave.data?.length ? (
            <ul className="list">
              {leave.data.map((l) => (
                <li key={l.id}>
                  <div><strong>{date(l.startDate)} – {date(l.endDate)}</strong> <span className="muted small">· {l.days} day(s) {l.type}</span>{l.reviewNote && <div className="small muted">{l.reviewedBy}: {l.reviewNote}</div>}</div>
                  <div className="row"><Status value={l.status} />{l.status === "pending" && <Button size="sm" variant="ghost" onClick={() => void cancel(l.id)}>Withdraw</Button>}</div>
                </li>
              ))}
            </ul>
          ) : <Empty icon="umbrella" title="No leave requested" />}
        </section>
      </div>
      {requesting && <RequestLeave onClose={() => setRequesting(false)} onDone={() => { setRequesting(false); void leave.reload(); }} />}
    </>
  );
}

function RequestLeave({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ type: "annual", startDate: "", endDate: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/hr/leave/me", { ...form, reason: form.reason || undefined });
      toast("Leave requested. HR has been told.");
      onDone();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Request leave" onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorNote error={error} />
        <div className="form-grid">
          <SelectField label="Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} options={["annual", "sick", "maternity", "study", "unpaid", "other"]} />
          <TextField label="First day" type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          <TextField label="Last day" type="date" required value={form.endDate} min={form.startDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          <TextArea label="Reason (optional)" className="span-all" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </div>
        <div className="form-actions"><Button type="submit" loading={busy}>Send request</Button></div>
      </form>
    </Modal>
  );
}

type LeaveRow = Leave & { staff: { name: string }; staffId: string };

export function LeaveApprovals() {
  const toast = useToast();
  const [status, setStatus] = useState("pending");
  const { data, loading, reload } = useData<Paged<LeaveRow>>(`/r/leave-requests?status=${status}&pageSize=100`, ["leave-requests"]);
  const away = useData<Array<{ id: string; startDate: string; endDate: string; type: string; staff: { name: string } }>>("/hr/away", ["leave-requests"]);
  const [deciding, setDeciding] = useState<{ row: LeaveRow; status: "approved" | "rejected" } | null>(null);
  const [note, setNote] = useState("");
  usePageMeta("Leave requests");
  async function decide() {
    if (!deciding) return;
    try {
      await api.post(`/hr/leave/${deciding.row.id}/decide`, { status: deciding.status, note: note || undefined });
      toast(deciding.status === "approved" ? "Approved." : "Declined.");
      setDeciding(null);
      setNote("");
      void reload();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }
  return (
    <>
      <PageHead title="Leave requests" />
      {away.data?.length ? <div className="alert"><Icon name="calendar" /><div><strong>Away now or in the next two weeks:</strong> {away.data.map((a) => `${a.staff.name} (${date(a.startDate)}–${date(a.endDate)})`).join(", ")}</div></div> : null}
      <div className="tabs" role="tablist">{["pending", "approved", "rejected"].map((s) => <button key={s} className="tab" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}>{s[0].toUpperCase() + s.slice(1)}</button>)}</div>
      {loading ? <Loading /> : data?.items.length ? (
        <div className="stack">
          {data.items.map((l) => (
            <article key={l.id} className="card row-between">
              <div><strong>{l.staff.name}</strong> · {l.days} day(s) {l.type}<div className="muted small">{date(l.startDate)} – {date(l.endDate)}{l.reason ? ` · ${l.reason}` : ""}</div></div>
              {l.status === "pending" ? <div className="row"><Button size="sm" icon="check" onClick={() => setDeciding({ row: l, status: "approved" })}>Approve</Button><Button size="sm" variant="outline" onClick={() => setDeciding({ row: l, status: "rejected" })}>Decline</Button></div> : <Status value={l.status} />}
            </article>
          ))}
        </div>
      ) : <div className="card"><Empty icon="umbrella" title={`No ${status} requests`} /></div>}
      {deciding && (
        <Modal title={`${deciding.status === "approved" ? "Approve" : "Decline"} ${deciding.row.staff.name}'s leave`} onClose={() => setDeciding(null)} footer={<><Button variant="outline" onClick={() => setDeciding(null)}>Cancel</Button><Button variant={deciding.status === "rejected" ? "danger" : ""} onClick={() => void decide()}>Confirm</Button></>}>
          <TextArea label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        </Modal>
      )}
    </>
  );
}

interface Colleague { id: string; name: string; email: string; phone: string | null; department: string; jobTitle: string | null; photoUrl: string | null; bio: string | null }

export function Directory() {
  const { data, loading } = useData<Colleague[]>("/hr/directory", ["staff"]);
  const [q, setQ] = useState("");
  usePageMeta("Team directory");
  const shown = (data ?? []).filter((c) => !q || `${c.name} ${c.jobTitle ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHead title="Team directory" />
      <input className="input" style={{ maxWidth: 320, marginBottom: "1rem" }} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search colleagues" />
      {loading ? <Loading /> : (
        <div className="grid">
          {shown.map((c) => (
            <article key={c.id} className="card stack">
              <div className="row"><Avatar name={c.name} src={c.photoUrl} size={48} /><div><strong>{c.name}</strong><div className="muted small">{c.jobTitle}</div></div></div>
              {c.bio && <p className="small muted" style={{ margin: 0 }}>{c.bio}</p>}
              <div className="row small">
                <a href={`mailto:${c.email}`}><Icon name="mail" /> Email</a>
                {c.phone && <a href={`tel:${c.phone}`}><Icon name="phone" /> {c.phone}</a>}
                <Link to="/admin/messages"><Icon name="message-square" /> Message</Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
