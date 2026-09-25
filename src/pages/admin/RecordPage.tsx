import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Check, Confirm, Empty, ErrorNote, Loading, Modal, PageHead, SelectField, Status, TextArea, TextField } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/Toasts";
import { useStaff } from "@/context/AuthContext";
import { useSite } from "@/context/SiteContext";
import { useData, usePageMeta } from "@/hooks/useData";
import { useSchema, useSchemaReady, type ResourceSchema } from "@/admin/SchemaContext";
import { RecordForm, RefPicker } from "@/admin/RecordForm";
import { FieldValue } from "@/admin/FieldValue";
import { can } from "@/admin/access";
import { api, mediaUrl } from "@/services/api";
import { dateTime, relative } from "@/lib/format";

type Row = Record<string, unknown> & { id: string };

interface ActivityItem { id: string; actorName: string | null; summary: string; createdAt: string; undoneAt: string | null }

/** One record: its details, editing, deleting, its history — plus the actions that belong to it (accept an application, confirm a payment…). */
export default function RecordPage() {
  const { resource, id } = useParams();
  const schema = useSchema(resource);
  const ready = useSchemaReady();
  const user = useStaff();
  const navigate = useNavigate();
  const toast = useToast();
  const { content } = useSite();
  const { data: row, loading, error, reload } = useData<Row>(schema ? `/r/${schema.key}/${id}` : null, schema ? [schema.key] : []);
  const history = useData<{ items: ActivityItem[] }>(schema ? `/activity?entity=${schema.key}&entityId=${id}` : null, ["activity"]);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  usePageMeta(row && schema ? String(row[schema.titleField] ?? schema.singular) : "Record");

  if (!ready || loading) return <Loading />;
  if (!schema) return <Empty title="Unknown record type" />;
  if (error || !row) return <><ErrorNote error={error ?? new Error("Not found")} /><Link to={`/admin/r/${schema.key}`}>Back to {schema.label}</Link></>;

  const mayEdit = can(user, schema.module, "edit") && schema.canUpdate;
  const mayDelete = schema.canDelete && can(user, schema.module, schema.deleteLevel);
  const title = String(row[schema.titleField] ?? schema.singular);
  const shown = schema.fields.filter((f) => !f.hidden);

  async function remove() {
    setBusy(true);
    try {
      await api.del(`/r/${schema!.key}/${id}`);
      toast(`${schema!.singular} deleted.`, "success", schema!.cascades ? undefined : { label: "Undo", run: () => navigate("/admin/activity") });
      navigate(`/admin/r/${schema!.key}`);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="breadcrumb" style={{ color: "var(--muted)", marginBottom: ".5rem" }}>
        <Link to={`/admin/r/${schema.key}`}><Icon name="chevron-left" /> {schema.label}</Link>
      </div>
      <PageHead
        title={title}
        description={schema.singular}
        actions={
          <>
            {mayEdit && !editing && <Button variant="outline" icon="edit" onClick={() => setEditing(true)}>Edit</Button>}
            {mayDelete && <Button variant="ghost" icon="trash" onClick={() => setDeleting(true)}>Delete</Button>}
          </>
        }
      />
      <RecordActions schema={schema} row={row} reload={reload} />
      <div className="grid-2">
        <section className="card">
          {editing ? (
            <RecordForm schema={schema} record={row} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); toast("Saved."); void reload(); }} />
          ) : (
            <table className="table">
              <tbody>
                {shown.map((f) => (
                  <tr key={f.name}>
                    <th style={{ width: "38%" }}>{f.label}</th>
                    <td style={{ whiteSpace: f.type === "text" || f.type === "richtext" ? "pre-wrap" : undefined }}>
                      {f.type === "text" || f.type === "richtext" ? String(row[f.name] ?? "—") : <FieldValue field={f} row={row} currency={content?.institution.currency} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card">
          <h2>History</h2>
          {history.data?.items.length ? (
            <ul className="list small">
              {history.data.items.map((h) => (
                <li key={h.id}><span>{h.summary}{h.undoneAt && <span className="badge" style={{ marginLeft: ".4rem" }}>undone</span>}<br /><span className="muted">{h.actorName ?? "System"}</span></span><span className="muted" title={dateTime(h.createdAt)}>{relative(h.createdAt)}</span></li>
              ))}
            </ul>
          ) : <p className="muted small">No changes recorded yet.</p>}
        </section>
      </div>
      {deleting && (
        <Confirm
          title={`Delete this ${schema.singular.toLowerCase()}?`}
          danger
          busy={busy}
          confirmLabel="Delete"
          message={schema.cascades ? "Everything linked to it (for example registers, submissions or invoices) will be deleted too, and this can't be undone." : "You can undo this afterwards from Activity & undo."}
          onClose={() => setDeleting(false)}
          onConfirm={() => void remove()}
        />
      )}
    </>
  );
}

/** Buttons and panels that only make sense for some kinds of record. */
function RecordActions({ schema, row, reload }: { schema: ResourceSchema; row: Row; reload: () => Promise<void> | void }) {
  const user = useStaff();
  const editor = can(user, schema.module, "edit");
  switch (schema.key) {
    case "applications":
      return editor ? <ApplicationActions row={row} reload={reload} /> : null;
    case "payments":
      return <PaymentActions row={row} reload={reload} editor={editor} />;
    case "invoices":
      return <div className="row" style={{ marginBottom: "1rem" }}><Link className="btn btn-outline btn-sm" to={`/admin/finance/statement/${row.studentId}`}><Icon name="file-text" /> Student's statement</Link><Link className="btn btn-outline btn-sm" to={`/admin/students/${row.studentId}`}><Icon name="user" /> Student</Link></div>;
    case "classes":
      return <div className="row" style={{ marginBottom: "1rem" }}><Link className="btn btn-sm" to={`/admin/teaching/${row.id}`}><Icon name="school" /> Open class (register, marks)</Link><Link className="btn btn-outline btn-sm" to={`/admin/r/enrollments?classId=${row.id}`}><Icon name="users" /> Enrolments</Link></div>;
    case "exams":
      return <div className="row" style={{ marginBottom: "1rem" }}><Link className="btn btn-sm" to={`/admin/teaching/exams/${row.id}`}><Icon name="edit" /> Exam builder</Link><Link className="btn btn-outline btn-sm" to={`/admin/teaching/exams/${row.id}/marking`}><Icon name="check-square" /> Marking</Link></div>;
    case "enquiries": {
      const phone = String(row.phone ?? "").replace(/[^\d+]/g, "");
      return phone ? <div className="row" style={{ marginBottom: "1rem" }}><a className="btn btn-outline btn-sm" href={`tel:${phone}`}><Icon name="phone" /> Call</a><a className="btn btn-outline btn-sm" href={`https://wa.me/${phone.replace(/^\+/, "")}`} target="_blank" rel="noopener noreferrer"><Icon name="message-circle" /> WhatsApp</a></div> : null;
    }
    case "leave-requests":
      return can(user, "hr", "edit") && row.status === "pending" ? <LeaveDecision row={row} reload={reload} /> : null;
    case "exam-registrations":
    case "certificates":
      return row.paymentProofUrl ? <p><a href={mediaUrl(row.paymentProofUrl as string)} target="_blank" rel="noopener noreferrer"><Icon name="paperclip" /> Payment proof</a></p> : null;
    default:
      return null;
  }
}

function ApplicationActions({ row, reload }: { row: Row; reload: () => Promise<void> | void }) {
  const toast = useToast();
  const [accepting, setAccepting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const placement = useData<Row>(row.placementAttemptId ? `/r/placement-results/${row.placementAttemptId}` : null);

  async function changeStatus() {
    setBusy(true);
    try {
      await api.post(`/admissions/applications/${row.id}/status`, { status, message: message || undefined });
      toast("Updated and the applicant was emailed.");
      setStatus(null);
      void reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (row.status === "accepted") {
    return <Alert tone="success">Accepted. <Link to={`/admin/students/${row.studentId}`}>Open the student record</Link>.</Alert>;
  }
  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <div className="row-between">
        <div>
          <strong>Decide this application</strong> <Status value={row.status as string} />
          {placement.data && <p className="small muted" style={{ margin: ".3rem 0 0" }}>Placement test: {String(placement.data.language)} · {String(placement.data.score)}/{String(placement.data.total)} · recommended {String(placement.data.recommendedLevel)}</p>}
          {row.paymentProofUrl ? <p className="small" style={{ margin: ".3rem 0 0" }}><a href={mediaUrl(row.paymentProofUrl as string)} target="_blank" rel="noopener noreferrer"><Icon name="paperclip" /> Application fee proof</a></p> : null}
        </div>
        <div className="row">
          {row.status !== "reviewing" && <Button variant="outline" size="sm" onClick={() => setStatus("reviewing")}>Reviewing</Button>}
          <Button variant="outline" size="sm" onClick={() => setStatus("waitlisted")}>Waiting list</Button>
          <Button variant="outline" size="sm" onClick={() => setStatus("rejected")}>Not accepted</Button>
          <Button variant="gold" size="sm" icon="check" onClick={() => setAccepting(true)}>Accept</Button>
        </div>
      </div>
      {status && (
        <Modal title={`Mark as ${status}`} onClose={() => setStatus(null)} footer={<><Button variant="outline" onClick={() => setStatus(null)}>Cancel</Button><Button loading={busy} onClick={() => void changeStatus()}>Save and email the applicant</Button></>}>
          <TextArea label="Message to the applicant (optional)" value={message} onChange={(e) => setMessage(e.target.value)} />
        </Modal>
      )}
      {accepting && <AcceptDialog row={row} onClose={() => setAccepting(false)} onDone={() => { setAccepting(false); void reload(); }} />}
    </div>
  );
}

function AcceptDialog({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [classId, setClassId] = useState<string | null>(null);
  const [level, setLevel] = useState(String(row.level ?? "A1"));
  const [invoice, setInvoice] = useState({ amount: "", description: `Tuition – ${row.course}`, due: "" });
  const [invite, setInvite] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ student: { id: string; studentNo: string }; invitation: { sent: boolean; error?: string } }>(`/admissions/applications/${row.id}/accept`, {
        classId: classId ?? undefined,
        level,
        invoiceAmount: invoice.amount ? Number(invoice.amount) : undefined,
        invoiceDescription: invoice.description || undefined,
        invoiceDueDate: invoice.due || undefined,
        sendInvitation: invite,
        message: message || undefined,
      });
      toast(`Accepted as ${result.student.studentNo}. ${invite ? (result.invitation.sent ? "The portal invitation was emailed." : `The invitation email failed: ${result.invitation.error ?? "email is not set up"}.`) : ""}`, invite && !result.invitation.sent ? "error" : "success");
      onDone();
      navigate(`/admin/students/${result.student.id}`);
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Accept ${row.name}`} onClose={onClose} wide>
      <form onSubmit={submit}>
        <p className="muted">This creates the student record and number, places them in a class, raises the first invoice and emails them how to open their portal — all at once.</p>
        <ErrorNote error={error} />
        <div className="form-grid">
          <div className="field"><label>Class</label><RefPicker field={{ name: "classId", label: "Class", type: "ref", ref: "classes" }} value={classId} onChange={setClassId} /><span className="hint">Leave empty to place them later.</span></div>
          <SelectField label="Level" value={level} onChange={(e) => setLevel(e.target.value)} options={["A1", "A2", "B1", "B2", "C1", "C2"]} />
          <TextField label="First invoice amount" type="number" min="0" value={invoice.amount} onChange={(e) => setInvoice({ ...invoice, amount: e.target.value })} hint="Leave empty to invoice later." />
          <TextField label="Invoice description" value={invoice.description} onChange={(e) => setInvoice({ ...invoice, description: e.target.value })} />
          <TextField label="Invoice due date" type="date" value={invoice.due} onChange={(e) => setInvoice({ ...invoice, due: e.target.value })} />
          <TextArea label="Message in the acceptance email (optional)" className="span-all" value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
        <Check label="Email the student a link to open their portal" checked={invite} onChange={(e) => setInvite(e.target.checked)} />
        <div className="form-actions"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" variant="gold" loading={busy}>Accept application</Button></div>
      </form>
    </Modal>
  );
}

function PaymentActions({ row, reload, editor }: { row: Row; reload: () => Promise<void> | void; editor: boolean }) {
  const toast = useToast();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try {
      const result = await api.post<{ receiptNo: string }>(`/finance/payments/${row.id}/confirm`);
      toast(`Confirmed. Receipt ${result.receiptNo}.`);
      void reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function reject() {
    setBusy(true);
    try {
      await api.post(`/finance/payments/${row.id}/reject`, { reason: reason || undefined });
      toast("Marked as not accepted. The student was told.");
      setRejecting(false);
      void reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="row" style={{ marginBottom: "1rem" }}>
      {row.proofUrl ? <a className="btn btn-outline btn-sm" href={mediaUrl(row.proofUrl as string)} target="_blank" rel="noopener noreferrer"><Icon name="paperclip" /> Proof of payment</a> : null}
      {row.status === "pending" && editor && <><Button size="sm" icon="check" loading={busy} onClick={() => void confirm()}>Confirm payment</Button><Button size="sm" variant="outline" onClick={() => setRejecting(true)}>Not accepted</Button></>}
      {row.status === "confirmed" && <Link className="btn btn-outline btn-sm" to={`/admin/finance/receipt/${row.id}`}><Icon name="printer" /> Receipt</Link>}
      {rejecting && (
        <Modal title="Payment not accepted" onClose={() => setRejecting(false)} footer={<><Button variant="outline" onClick={() => setRejecting(false)}>Cancel</Button><Button variant="danger" loading={busy} onClick={() => void reject()}>Tell the student</Button></>}>
          <TextArea label="Reason (shown to the student)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. We couldn't find this reference on our statement." />
        </Modal>
      )}
    </div>
  );
}

function LeaveDecision({ row, reload }: { row: Row; reload: () => Promise<void> | void }) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function decide(status: "approved" | "rejected") {
    setBusy(true);
    try {
      await api.post(`/hr/leave/${row.id}/decide`, { status, note: note || undefined });
      toast(status === "approved" ? "Approved." : "Declined.");
      void reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <TextField label="Note to the staff member (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row"><Button loading={busy} icon="check" onClick={() => void decide("approved")}>Approve</Button><Button variant="outline" loading={busy} onClick={() => void decide("rejected")}>Decline</Button></div>
    </div>
  );
}
