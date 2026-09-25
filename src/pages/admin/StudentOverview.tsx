import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Avatar, Button, Empty, Loading, Modal, PageHead, Status } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/Toasts";
import { useStaff } from "@/context/AuthContext";
import { useSite } from "@/context/SiteContext";
import { useData, usePageMeta } from "@/hooks/useData";
import { useSchema } from "@/admin/SchemaContext";
import { RecordForm } from "@/admin/RecordForm";
import { can } from "@/admin/access";
import { api } from "@/services/api";
import { date, money } from "@/lib/format";
import type { Paged } from "@/lib/types";

type Row = Record<string, unknown> & { id: string };

/** Everything about one student on one page: details, classes, fees, results, certificates. */
export default function StudentOverview() {
  const { id } = useParams();
  const user = useStaff();
  const toast = useToast();
  const { content } = useSite();
  const schema = useSchema("students");
  const student = useData<Row>(`/r/students/${id}`, ["students"]);
  const enrollments = useData<Paged<Row>>(`/r/enrollments?studentId=${id}&pageSize=50`, ["enrollments"]);
  const invoices = useData<Paged<Row>>(can(user, "finance") ? `/r/invoices?studentId=${id}&pageSize=50` : null, ["invoices"]);
  const certificates = useData<Paged<Row>>(`/r/certificates?studentId=${id}&pageSize=50`, ["certificates"]);
  const skills = useData<Paged<Row>>(`/r/skill-assessments?studentId=${id}&pageSize=10`, ["skill-assessments"]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  usePageMeta(student.data ? String(student.data.name) : "Student");
  if (student.loading || !student.data) return <Loading />;
  const s = student.data;
  const currency = content?.institution.currency;
  const balance = (invoices.data?.items ?? []).filter((i) => ["pending", "partial", "overdue"].includes(String(i.status))).reduce((sum, i) => sum + Number(i.amount) - Number(i.discount) - Number(i.paid), 0);

  async function invite() {
    setBusy(true);
    try {
      const result = await api.post<{ sent: boolean; error?: string }>(`/students/${id}/invite`);
      toast(result.sent ? "Portal invitation sent." : `Couldn't send: ${result.error ?? "email isn't set up"}`, result.sent ? "success" : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="breadcrumb" style={{ marginBottom: ".5rem" }}><Link to="/admin/r/students"><Icon name="chevron-left" /> Students</Link></div>
      <PageHead
        title={<span className="row"><Avatar name={String(s.name)} src={s.photoUrl as string} size={48} /> {String(s.name)}</span>}
        description={`${s.studentNo} · ${s.email}${s.phone ? ` · ${s.phone}` : ""}`}
        actions={
          <>
            {can(user, "students", "edit") && <Button variant="outline" icon="edit" onClick={() => setEditing(true)}>Edit details</Button>}
            {can(user, "students", "edit") && <Button variant="outline" icon="mail" loading={busy} onClick={() => void invite()}>Send portal invitation</Button>}
            <Link className="btn btn-outline" to="/admin/messages"><Icon name="message-square" /> Message</Link>
          </>
        }
      />
      <div className="kpis">
        <div className="kpi"><span className="stat-label">Status</span><span className="stat-value" style={{ fontSize: "1.2rem" }}><Status value={s.status as string} /></span></div>
        <div className="kpi"><span className="stat-label">Level</span><span className="stat-value">{String(s.level ?? "—")}</span></div>
        {invoices.data && <Link className={`kpi ${balance > 0 ? "alert-kpi" : ""}`} to={`/admin/finance/statement/${id}`}><span className="stat-label">Balance</span><span className="stat-value">{money(balance, currency)}</span></Link>}
        <div className="kpi"><span className="stat-label">Student since</span><span className="stat-value" style={{ fontSize: "1.2rem" }}>{date(s.createdAt as string)}</span></div>
      </div>
      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Classes</h2><Link className="small" to={`/admin/r/enrollments?studentId=${id}`}>Manage</Link></div>
          {enrollments.data?.items.length ? <ul className="list">{enrollments.data.items.map((e) => <li key={e.id}><Link to={`/admin/teaching/${e.classId}`}>{String((e.class as Row | undefined)?.name ?? "Class")}</Link><Status value={e.status as string} /></li>)}</ul> : <Empty title="Not in a class" />}
        </section>
        {invoices.data && (
          <section className="card">
            <div className="card-head"><h2>Invoices</h2><Link className="small" to={`/admin/finance/statement/${id}`}>Statement</Link></div>
            {invoices.data.items.length ? <ul className="list">{invoices.data.items.map((i) => <li key={i.id}><Link to={`/admin/r/invoices/${i.id}`}>{String(i.description)}</Link><span className="row small">{money(Number(i.amount) - Number(i.discount), currency)} <Status value={i.status as string} /></span></li>)}</ul> : <Empty title="No invoices" />}
          </section>
        )}
        <section className="card">
          <div className="card-head"><h2>Skills reports</h2><Link className="small" to={`/admin/r/skill-assessments?studentId=${id}`}>All</Link></div>
          {skills.data?.items.length ? <ul className="list">{skills.data.items.map((k) => <li key={k.id}><span>{String(k.term ?? date(k.createdAt as string))}</span><span className="small">R {String(k.reading ?? "–")} · W {String(k.writing ?? "–")} · L {String(k.listening ?? "–")} · S {String(k.speaking ?? "–")} {k.cefrLevel ? <strong>· {String(k.cefrLevel)}</strong> : null}</span></li>)}</ul> : <Empty title="No reports yet" />}
        </section>
        <section className="card">
          <div className="card-head"><h2>Certificates</h2>{can(user, "students", "edit") && <Link className="small" to={`/admin/r/certificates?studentId=${id}`}>Issue</Link>}</div>
          {certificates.data?.items.length ? <ul className="list">{certificates.data.items.map((c) => <li key={c.id}><span>{String(c.course)} {c.level ? `(${String(c.level)})` : ""}</span><span className="mono small">{String(c.verificationCode)}</span></li>)}</ul> : <Empty title="None issued" />}
        </section>
      </div>
      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Details</h2>
        <div className="grid">
          {[["Date of birth", date(s.dateOfBirth as string)], ["Gender", s.gender], ["Nationality", s.nationality], ["Address", s.address], ["Guardian", s.guardianName], ["Guardian phone", s.guardianPhone], ["Course", s.course], ["Notes", s.notes]].map(([label, value]) => (
            <div key={String(label)}><div className="muted small">{String(label)}</div><div>{String(value ?? "—")}</div></div>
          ))}
        </div>
      </section>
      {editing && schema && (
        <Modal title="Edit student" onClose={() => setEditing(false)} wide>
          <RecordForm schema={schema} record={s} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); toast("Saved."); void student.reload(); }} />
        </Modal>
      )}
    </>
  );
}
