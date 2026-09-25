import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, Button, Empty, ErrorNote, Loading, Modal, PageHead, SelectField, Status, TextField } from "@/components/ui";
import { FileField } from "@/components/FileField";
import { useToast } from "@/components/Toasts";
import { useStudent } from "@/context/AuthContext";
import { useData, usePageMeta } from "@/hooks/useData";
import { api } from "@/services/api";
import { date, money } from "@/lib/format";

interface Invoice { id: string; invoiceNo: string; description: string; amount: number; discount: number; paid: number; balance: number; dueDate: string | null; status: string; createdAt: string }
interface Payment { id: string; receiptNo: string | null; amount: number; method: string; reference: string | null; status: string; note: string | null; createdAt: string }
interface FeesData { invoices: Invoice[]; payments: Payment[]; balance: number; currency: string; instructions: string }

export default function Fees() {
  const student = useStudent();
  const { data, loading, reload } = useData<FeesData>("/me/fees", [`fees:${student.id}`]);
  const [paying, setPaying] = useState<Invoice | null | "any">(null);
  usePageMeta("Fees & payments");
  if (loading || !data) return <Loading />;
  const open = data.invoices.filter((i) => ["pending", "partial", "overdue"].includes(i.status));
  return (
    <>
      <PageHead title="Fees & payments" actions={<><Link className="btn btn-outline" to="/portal/fees/statement">Statement</Link><Button icon="upload" onClick={() => setPaying("any")}>Report a payment</Button></>} />
      <div className="kpis">
        <div className={`kpi ${data.balance > 0 ? "alert-kpi" : ""}`}><span className="stat-label">Balance to pay</span><span className="stat-value">{money(data.balance, data.currency)}</span></div>
        <div className="kpi"><span className="stat-label">Waiting for confirmation</span><span className="stat-value">{data.payments.filter((p) => p.status === "pending").length}</span></div>
      </div>
      <Alert>{data.instructions}</Alert>
      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2>Invoices</h2>
        {data.invoices.length ? (
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>Invoice</th><th>For</th><th className="num">Amount</th><th className="num">Paid</th><th className="num">Balance</th><th>Due</th><th>Status</th><th /></tr></thead>
              <tbody>
                {data.invoices.map((i) => (
                  <tr key={i.id}>
                    <td data-label="Invoice" className="mono">{i.invoiceNo}</td>
                    <td data-label="For">{i.description}</td>
                    <td data-label="Amount" className="num">{money(i.amount - i.discount, data.currency)}</td>
                    <td data-label="Paid" className="num">{money(i.paid, data.currency)}</td>
                    <td data-label="Balance" className="num"><strong>{money(i.balance, data.currency)}</strong></td>
                    <td data-label="Due">{date(i.dueDate)}</td>
                    <td data-label="Status"><Status value={i.status} /></td>
                    <td>{open.includes(i) && <Button size="sm" variant="outline" onClick={() => setPaying(i)}>I've paid</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon="file-text" title="No invoices" />}
      </section>
      <section className="card">
        <h2>Payments</h2>
        {data.payments.length ? (
          <ul className="list">
            {data.payments.map((p) => (
              <li key={p.id}>
                <div><strong>{money(p.amount, data.currency)}</strong> <span className="muted small">· {p.method} · {date(p.createdAt)}{p.reference ? ` · ${p.reference}` : ""}</span>{p.status === "rejected" && p.note && <div className="small" style={{ color: "var(--danger)" }}>{p.note}</div>}</div>
                <div className="row"><Status value={p.status} />{p.receiptNo && <Link className="btn btn-ghost btn-sm" to={`/portal/fees/receipt/${p.id}`}>Receipt</Link>}</div>
              </li>
            ))}
          </ul>
        ) : <Empty icon="wallet" title="No payments yet" />}
      </section>
      {paying && <ReportPayment invoices={open} preselect={paying === "any" ? undefined : paying} currency={data.currency} onClose={() => setPaying(null)} onDone={() => { setPaying(null); void reload(); }} />}
    </>
  );
}

function ReportPayment({ invoices, preselect, currency, onClose, onDone }: { invoices: Invoice[]; preselect?: Invoice; currency: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ invoiceId: preselect?.id ?? invoices[0]?.id ?? "", amount: String(preselect?.balance ?? invoices[0]?.balance ?? ""), method: "airtel", reference: "" });
  const [proof, setProof] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/me/payments", { invoiceId: form.invoiceId || undefined, amount: Number(form.amount), method: form.method, reference: form.reference || undefined, proofUrl: proof });
      toast("Thank you! Finance will confirm your payment soon.");
      onDone();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Report a payment" onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorNote error={error} />
        {invoices.length > 0 && <SelectField label="For invoice" value={form.invoiceId} onChange={(e) => setForm({ ...form, invoiceId: e.target.value })} options={invoices.map((i) => ({ value: i.id, label: `${i.invoiceNo} · ${i.description} · ${money(i.balance, currency)} left` }))} />}
        <div className="form-grid">
          <TextField label={`Amount (${currency})`} type="number" min="1" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <SelectField label="Paid with" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} options={[{ value: "airtel", label: "Airtel Money" }, { value: "tnm", label: "TNM Mpamba" }, { value: "bank", label: "Bank transfer / deposit" }, { value: "cash", label: "Cash at the office" }, { value: "card", label: "Card" }]} />
          <TextField label="Transaction reference" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className="span-all" hint="The code from the confirmation SMS or bank slip." />
        </div>
        <FileField label="Photo of the confirmation or bank slip" value={proof} onChange={setProof} realm="student" accept="image/*,application/pdf" required />
        <div className="form-actions"><Button type="submit" loading={busy} disabled={!proof || !form.amount}>Send to finance</Button></div>
      </form>
    </Modal>
  );
}

interface ReceiptData { payment: { receiptNo: string; amount: number; method: string; reference: string | null; confirmedAt: string; confirmedBy: string | null; student: { name: string; studentNo: string }; invoice: { invoiceNo: string; description: string } | null }; balance: number | null; currency: string; institution: { name: string; location: string } }

export function Receipt({ staff }: { staff?: boolean }) {
  const { id } = useParams();
  const { data, loading } = useData<ReceiptData>(staff ? `/finance/receipt/${id}` : `/me/fees/receipts/${id}`);
  usePageMeta("Receipt");
  if (loading || !data) return <Loading />;
  const p = data.payment;
  return (
    <>
      <div className="row no-print" style={{ marginBottom: "1rem" }}><Button icon="printer" onClick={() => window.print()}>Print or save as PDF</Button></div>
      <div className="receipt">
        <div className="row-between"><div><h1>{data.institution.name}</h1><p>{data.institution.location}</p></div><img src="/img/logo.png" alt="" width="64" height="64" /></div>
        <h2>Payment receipt</h2>
        <table>
          <tbody>
            <tr><th>Receipt number</th><td>{p.receiptNo}</td></tr>
            <tr><th>Date</th><td>{date(p.confirmedAt)}</td></tr>
            <tr><th>Received from</th><td>{p.student.name} ({p.student.studentNo})</td></tr>
            {p.invoice && <tr><th>For</th><td>{p.invoice.description} (invoice {p.invoice.invoiceNo})</td></tr>}
            <tr><th>Paid by</th><td>{p.method}{p.reference ? ` · ${p.reference}` : ""}</td></tr>
            <tr><th>Amount</th><td><strong>{money(p.amount, data.currency)}</strong></td></tr>
            {data.balance !== null && <tr><th>Balance remaining on this invoice</th><td>{money(data.balance, data.currency)}</td></tr>}
          </tbody>
        </table>
        <p style={{ marginTop: "2rem", fontSize: ".85rem" }}>Confirmed by {p.confirmedBy ?? "the finance office"}. Thank you.</p>
      </div>
    </>
  );
}

interface StatementData { student: { name: string; studentNo: string; course: string | null; level: string | null }; invoices: Invoice[]; payments: Payment[]; totals: { billed: number; paid: number; balance: number }; currency: string; generatedAt: string }

export function Statement({ studentId }: { studentId?: string }) {
  const { data, loading } = useData<StatementData>(studentId ? `/finance/statement/${studentId}` : "/me/fees/statement");
  usePageMeta("Statement");
  if (loading || !data) return <Loading />;
  const rows = [
    ...data.invoices.filter((i) => i.status !== "cancelled").map((i) => ({ at: i.createdAt, text: `${i.description} (${i.invoiceNo})`, debit: i.amount - i.discount, credit: 0 })),
    ...data.payments.filter((p) => p.status === "confirmed").map((p) => ({ at: p.createdAt, text: `Payment ${p.receiptNo ?? ""} · ${p.method}`, debit: 0, credit: p.amount })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  let running = 0;
  return (
    <>
      <div className="row no-print" style={{ marginBottom: "1rem" }}><Button icon="printer" onClick={() => window.print()}>Print or save as PDF</Button></div>
      <div className="receipt">
        <div className="row-between"><div><h1>Fee statement</h1><p>{data.student.name} · {data.student.studentNo}</p></div><img src="/img/logo.png" alt="" width="64" height="64" /></div>
        <table>
          <thead><tr><th>Date</th><th>Details</th><th className="num">Charged</th><th className="num">Paid</th><th className="num">Balance</th></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              running += r.debit - r.credit;
              return <tr key={i}><td>{date(r.at)}</td><td>{r.text}</td><td className="num">{r.debit ? money(r.debit, data.currency) : ""}</td><td className="num">{r.credit ? money(r.credit, data.currency) : ""}</td><td className="num">{money(running, data.currency)}</td></tr>;
            })}
          </tbody>
        </table>
        <p style={{ marginTop: "1rem" }}><strong>Balance due: {money(data.totals.balance, data.currency)}</strong></p>
        <p style={{ fontSize: ".8rem" }}>Generated {date(data.generatedAt)}</p>
      </div>
    </>
  );
}
