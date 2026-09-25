import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Check, Empty, ErrorNote, Loading, Modal, PageHead, SelectField, TextArea, TextField } from "@/components/ui";
import { BarChart, shortMonth } from "@/components/Charts";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/Toasts";
import { useStaff } from "@/context/AuthContext";
import { useData, usePageMeta } from "@/hooks/useData";
import { RefPicker } from "@/admin/RecordForm";
import { can } from "@/admin/access";
import { api, mediaUrl } from "@/services/api";
import { date, money } from "@/lib/format";
import type { Paged } from "@/lib/types";
import { Receipt, Statement } from "../portal/Fees";

interface Summary { currency: string; billed: number; collected: number; outstanding: number; collectedThisMonth: number; pendingPayments: number; overdueInvoices: number; monthly: Array<{ month: string; amount: number }> }
interface Debtor { studentId: string; balance: number; student?: { id: string; name: string; studentNo: string; phone: string | null } }

export default function FinanceOverview() {
  const user = useStaff();
  const summary = useData<Summary>("/finance/summary", ["payments", "invoices"]);
  const debtors = useData<Debtor[]>("/finance/debtors", ["payments", "invoices"]);
  const [recording, setRecording] = useState(false);
  usePageMeta("Finance");
  if (summary.loading || !summary.data) return <Loading />;
  const s = summary.data;
  return (
    <>
      <PageHead
        title="Finance"
        actions={can(user, "finance", "edit") ? <><Link className="btn btn-outline" to="/admin/finance/bulk"><Icon name="layers" /> Invoice a class</Link><Button icon="plus" onClick={() => setRecording(true)}>Record a payment</Button></> : undefined}
      />
      <div className="kpis">
        <Link className="kpi" to="/admin/r/payments?status=confirmed"><span className="icon-wrap"><Icon name="wallet" /></span><span className="stat-label">Collected this month</span><span className="stat-value">{money(s.collectedThisMonth, s.currency)}</span></Link>
        <Link className={`kpi ${s.pendingPayments ? "alert-kpi" : ""}`} to="/admin/finance/payments"><span className="icon-wrap"><Icon name="check-circle" /></span><span className="stat-label">Payments to confirm</span><span className="stat-value">{s.pendingPayments}</span></Link>
        <div className="kpi"><span className="icon-wrap"><Icon name="file-text" /></span><span className="stat-label">Outstanding</span><span className="stat-value">{money(s.outstanding, s.currency)}</span></div>
        <Link className={`kpi ${s.overdueInvoices ? "alert-kpi" : ""}`} to="/admin/r/invoices?status=overdue"><span className="icon-wrap"><Icon name="alert" /></span><span className="stat-label">Overdue invoices</span><span className="stat-value">{s.overdueInvoices}</span></Link>
      </div>
      <div className="grid-2">
        <section className="card">
          <h2>Money received, last 6 months</h2>
          <BarChart data={s.monthly.map((m) => ({ label: shortMonth(m.month), value: m.amount }))} format={(v) => money(v, s.currency)} />
          <p className="muted small">Billed in total {money(s.billed, s.currency)} · collected {money(s.collected, s.currency)}.</p>
        </section>
        <section className="card">
          <h2>Largest balances</h2>
          {debtors.data?.length ? (
            <ul className="list">
              {debtors.data.slice(0, 10).map((d) => (
                <li key={d.studentId}>
                  <Link to={`/admin/finance/statement/${d.studentId}`}>{d.student?.name ?? "Student"} <span className="muted small">{d.student?.studentNo}</span></Link>
                  <strong>{money(d.balance, s.currency)}</strong>
                </li>
              ))}
            </ul>
          ) : <Empty icon="check-circle" title="Nobody owes anything" />}
        </section>
      </div>
      {recording && <RecordPayment onClose={() => setRecording(false)} />}
    </>
  );
}

/** Money received at the office: recorded and confirmed in one step, receipt ready to print. */
function RecordPayment({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [studentId, setStudentId] = useState<string | null>(null);
  const invoices = useData<Paged<{ id: string; invoiceNo: string; description: string; amount: number; discount: number; paid: number; status: string }>>(studentId ? `/r/invoices?studentId=${studentId}&pageSize=50` : null);
  const [form, setForm] = useState({ invoiceId: "", amount: "", method: "cash", reference: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const open = (invoices.data?.items ?? []).filter((i) => ["pending", "partial", "overdue"].includes(i.status));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payment = await api.post<{ id: string; receiptNo: string }>("/finance/payments", { studentId, invoiceId: form.invoiceId || undefined, amount: Number(form.amount), method: form.method, reference: form.reference || undefined, note: form.note || undefined });
      toast(`Payment recorded. Receipt ${payment.receiptNo}.`);
      navigate(`/admin/finance/receipt/${payment.id}`);
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Record a payment" onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorNote error={error} />
        <div className="field"><label className="required">Student</label><RefPicker field={{ name: "studentId", label: "Student", type: "ref", ref: "students", required: true }} value={studentId} onChange={setStudentId} /></div>
        {studentId && <SelectField label="Invoice" value={form.invoiceId} onChange={(e) => setForm({ ...form, invoiceId: e.target.value })} placeholder="Oldest unpaid invoice" options={open.map((i) => ({ value: i.id, label: `${i.invoiceNo} · ${i.description} · ${money(Number(i.amount) - Number(i.discount) - Number(i.paid))} left` }))} />}
        <div className="form-grid">
          <TextField label="Amount" type="number" min="1" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <SelectField label="Method" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} options={[{ value: "cash", label: "Cash" }, { value: "bank", label: "Bank" }, { value: "airtel", label: "Airtel Money" }, { value: "tnm", label: "TNM Mpamba" }, { value: "card", label: "Card" }]} />
          <TextField label="Reference" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          <TextField label="Note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>
        <div className="form-actions"><Button type="submit" loading={busy} disabled={!studentId || !form.amount}>Record and issue receipt</Button></div>
      </form>
    </Modal>
  );
}

interface PendingPayment { id: string; amount: number; method: string; reference: string | null; note: string | null; proofUrl: string | null; createdAt: string; studentId: string; student: { id: string; name: string }; invoice: { id: string; invoiceNo: string } | null }

/** Payments students reported, waiting to be matched against the bank or mobile money statement. */
export function PaymentsQueue() {
  const user = useStaff();
  const toast = useToast();
  const { data, loading, reload } = useData<Paged<PendingPayment>>("/r/payments?status=pending&pageSize=100&sort=createdAt&dir=asc", ["payments"]);
  const [rejecting, setRejecting] = useState<PendingPayment | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const editor = can(user, "finance", "edit");
  usePageMeta("Payments to check");

  async function confirm(p: PendingPayment) {
    setBusy(p.id);
    try {
      const result = await api.post<{ receiptNo: string }>(`/finance/payments/${p.id}/confirm`);
      toast(`Confirmed ${money(p.amount)} from ${p.student.name}. Receipt ${result.receiptNo}.`);
      void reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }
  async function reject() {
    if (!rejecting) return;
    setBusy(rejecting.id);
    try {
      await api.post(`/finance/payments/${rejecting.id}/reject`, { reason: reason || undefined });
      toast("The student has been told.");
      setRejecting(null);
      setReason("");
      void reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHead title="Payments to check" description="Oldest first. Check each against your bank or mobile money statement, then confirm." />
      {loading ? <Loading /> : data?.items.length ? (
        <div className="stack">
          {data.items.map((p) => (
            <article key={p.id} className="card row-between">
              <div>
                <strong>{money(p.amount)}</strong> from <Link to={`/admin/students/${p.studentId}`}>{p.student.name}</Link>
                <div className="muted small">{p.method}{p.reference ? ` · ref ${p.reference}` : ""} · {date(p.createdAt)}{p.invoice ? ` · for ${p.invoice.invoiceNo}` : ""}</div>
                {p.note && <div className="small">{p.note}</div>}
              </div>
              <div className="row">
                {p.proofUrl && <a className="btn btn-outline btn-sm" href={mediaUrl(p.proofUrl)} target="_blank" rel="noopener noreferrer"><Icon name="paperclip" /> Proof</a>}
                {editor && <><Button size="sm" icon="check" loading={busy === p.id} onClick={() => void confirm(p)}>Confirm</Button><Button size="sm" variant="outline" onClick={() => setRejecting(p)}>Not accepted</Button></>}
              </div>
            </article>
          ))}
        </div>
      ) : <div className="card"><Empty icon="check-circle" title="All payments are checked" /></div>}
      {rejecting && (
        <Modal title="Payment not accepted" onClose={() => setRejecting(null)} footer={<><Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button><Button variant="danger" loading={busy === rejecting.id} onClick={() => void reject()}>Tell the student</Button></>}>
          <TextArea label="Reason (shown to the student)" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Modal>
      )}
    </>
  );
}

export function BulkInvoice() {
  const toast = useToast();
  const [classId, setClassId] = useState<string | null>(null);
  const [form, setForm] = useState({ description: "", amount: "", dueDate: "" });
  const [skip, setSkip] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const fees = useData<Paged<{ id: string; name: string; amount: number }>>("/r/fees?active=true&pageSize=100");
  usePageMeta("Invoice a class");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ created: number; skipped: number }>("/finance/invoices/bulk", { classId, description: form.description, amount: Number(form.amount), dueDate: form.dueDate || undefined, skipDuplicates: skip });
      setResult(r);
      toast(`${r.created} invoices raised.`);
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHead title="Invoice a class" description="Raise the same invoice for every active student in a class. Students are notified in their portal." />
      <form className="card" onSubmit={submit} style={{ maxWidth: 720 }}>
        <ErrorNote error={error} />
        {result && <Alert tone="success">{result.created} invoices raised{result.skipped ? `, ${result.skipped} skipped because they already had this invoice` : ""}.</Alert>}
        <div className="field"><label className="required">Class</label><RefPicker field={{ name: "classId", label: "Class", type: "ref", ref: "classes", required: true }} value={classId} onChange={setClassId} /></div>
        {fees.data?.items.length ? <SelectField label="Start from a standard fee" value="" onChange={(e) => { const fee = fees.data!.items.find((f) => f.id === e.target.value); if (fee) setForm({ ...form, description: fee.name, amount: String(fee.amount) }); }} placeholder="Choose…" options={fees.data.items.map((f) => ({ value: f.id, label: `${f.name} · ${money(f.amount)}` }))} /> : null}
        <div className="form-grid">
          <TextField label="Description" required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Term 2 tuition 2026" />
          <TextField label="Amount" type="number" min="1" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <TextField label="Due date" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
        </div>
        <Check label="Skip students who already have an invoice with this description" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
        <div className="form-actions"><Button type="submit" loading={busy} disabled={!classId || !form.description || !form.amount}>Raise invoices</Button></div>
      </form>
    </>
  );
}

export function StaffStatement() {
  const { studentId } = useParams();
  return <><div className="breadcrumb no-print" style={{ marginBottom: ".5rem" }}><Link to={`/admin/students/${studentId}`}><Icon name="chevron-left" /> Student</Link></div><Statement studentId={studentId} /></>;
}

export function StaffReceipt() {
  return <><div className="breadcrumb no-print" style={{ marginBottom: ".5rem" }}><Link to="/admin/r/payments"><Icon name="chevron-left" /> Payments</Link></div><Receipt staff /></>;
}

