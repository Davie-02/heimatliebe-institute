import { useState, type FormEvent } from "react";
import { PageHero } from "./PageHero";
import { Alert, Button, Empty, ErrorNote, Loading, Modal, TextField } from "@/components/ui";
import { FileField } from "@/components/FileField";
import { Reveal } from "@/components/Reveal";
import { Icon } from "@/components/Icon";
import { useSite } from "@/context/SiteContext";
import { useData, usePageMeta } from "@/hooks/useData";
import { api } from "@/services/api";
import { date, money } from "@/lib/format";

interface Session { id: string; title: string; provider: string; level: string | null; modules: string | null; examDate: string; registrationDeadline: string | null; venue: string | null; fee: number | null; capacity: number | null }

export default function Exams() {
  const { content } = useSite();
  const { data, loading, error } = useData<Session[]>("/public/r/exam-sessions", ["exam-sessions"]);
  const [chosen, setChosen] = useState<Session | null>(null);
  usePageMeta("Official exams", "Register for Goethe-Zertifikat and other official language exams.");
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (data ?? []).filter((s) => s.examDate.slice(0, 10) >= today);

  return (
    <div className="page-enter">
      <PageHero title="Official exams" intro="Internationally recognised certificates such as the Goethe-Zertifikat. Register online and upload your payment." />
      <section className="section">
        <div className="container">
          <ErrorNote error={error} />
          {loading ? <Loading /> : upcoming.length ? (
            <ul className="timeline">
              {upcoming.map((s, i) => {
                const d = new Date(s.examDate);
                const closed = Boolean(s.registrationDeadline && s.registrationDeadline.slice(0, 10) < today);
                return (
                  <Reveal as="li" key={s.id} delay={i * 60}>
                    <div className="date-badge"><strong>{d.getUTCDate()}</strong><span>{d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}</span></div>
                    <div className="row-between">
                      <div>
                        <h3 style={{ margin: 0 }}>{s.title}</h3>
                        <p className="muted small" style={{ margin: ".2rem 0" }}>
                          {s.provider}{s.level ? ` · ${s.level}` : ""}{s.modules ? ` · ${s.modules}` : ""}{s.venue ? ` · ${s.venue}` : ""}
                        </p>
                        <p className="small" style={{ margin: 0 }}>
                          {s.fee ? <strong>{money(s.fee, content?.institution.currency)}</strong> : null}
                          {s.registrationDeadline && <span className="muted"> · Register by {date(s.registrationDeadline)}</span>}
                        </p>
                      </div>
                      <Button variant={closed ? "outline" : "gold"} disabled={closed} onClick={() => setChosen(s)}>{closed ? "Registration closed" : "Register"}</Button>
                    </div>
                  </Reveal>
                );
              })}
            </ul>
          ) : <Empty icon="award" title="No exam dates are published yet">We'll announce the next sessions here and on our news page.</Empty>}
        </div>
      </section>
      {chosen && <RegisterDialog session={chosen} onClose={() => setChosen(null)} paymentInstructions={content?.institution.paymentInstructions} />}
    </div>
  );
}

function RegisterDialog({ session, onClose, paymentInstructions }: { session: Session; onClose: () => void; paymentInstructions?: string }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", dateOfBirth: "", passportNo: "", modules: session.modules ?? "", website: "" });
  const [proof, setProof] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [done, setDone] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v));
      await api.post("/public/exam-registrations", { sessionId: session.id, ...body, ...(proof ? { paymentProofUrl: proof } : {}) });
      setDone(true);
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Register: ${session.title}`} onClose={onClose}>
      {done ? (
        <div className="stack">
          <Alert tone="success">Registration received. We've emailed you a confirmation and will confirm your place once the payment is checked.</Alert>
          <Button onClick={onClose}>Close</Button>
        </div>
      ) : (
        <form onSubmit={submit}>
          <ErrorNote error={error} />
          <div className="form-grid">
            <TextField label="Full name (as in passport)" required value={form.name} onChange={set("name")} />
            <TextField label="Email" type="email" required value={form.email} onChange={set("email")} />
            <TextField label="Phone" type="tel" required value={form.phone} onChange={set("phone")} />
            <TextField label="Date of birth" type="date" value={form.dateOfBirth} onChange={set("dateOfBirth")} />
            <TextField label="Passport or ID number" value={form.passportNo} onChange={set("passportNo")} />
            <TextField label="Modules" value={form.modules} onChange={set("modules")} hint="Leave as is to take the full exam." />
          </div>
          {paymentInstructions && <p className="small muted"><Icon name="info" /> {paymentInstructions}</p>}
          <FileField label="Proof of payment (optional now)" value={proof} onChange={setProof} realm="public" accept="image/*,application/pdf" />
          <input className="honeypot" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} aria-hidden />
          <div className="form-actions">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="gold" loading={busy}>Register</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
