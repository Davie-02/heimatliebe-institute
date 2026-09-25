import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHero } from "./PageHero";
import { Alert, Button, ErrorNote, SelectField, TextArea, TextField } from "@/components/ui";
import { FileField } from "@/components/FileField";
import { Icon } from "@/components/Icon";
import { useSite } from "@/context/SiteContext";
import { useData, usePageMeta } from "@/hooks/useData";
import { api, ApiError } from "@/services/api";
import { date, money } from "@/lib/format";
import type { Course } from "@/lib/types";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

function placementFromStorage(): { id: string; level: string } | null {
  try {
    return JSON.parse(sessionStorage.getItem("hml_placement") ?? "null");
  } catch {
    return null;
  }
}

export default function Apply() {
  const [params] = useSearchParams();
  const { content } = useSite();
  const courses = useData<Course[]>("/public/r/courses", ["courses"]);
  const placement = placementFromStorage();
  usePageMeta("Apply online", "Apply to study at Heimatliebe Institute in a few minutes.");
  const [form, setForm] = useState<Record<string, string>>({
    name: "", email: "", phone: "", course: params.get("course") ?? "", level: params.get("level") || placement?.level || "A1",
    dateOfBirth: "", gender: "", nationality: "Malawian", address: "", guardianName: "", guardianPhone: "", preferredSchedule: "", motivation: "", source: "", website: "",
  });
  const [proof, setProof] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const set = (key: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const institution = content?.institution;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ""));
      const result = await api.post<{ reference: string }>("/public/applications", { ...body, ...(proof ? { paymentProofUrl: proof } : {}), ...(placement ? { placementAttemptId: placement.id } : {}) });
      setDone(result.reference);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="page-enter">
        <PageHero title="Application received" />
        <section className="section">
          <div className="narrow form-card" style={{ textAlign: "center" }}>
            <Icon name="check-circle" className="" />
            <h2>Thank you!</h2>
            <p>Your reference number is</p>
            <p className="result-level" style={{ fontSize: "2.2rem" }}>{done}</p>
            <p className="muted">We've emailed it to you. Keep it to check your application's progress. The admissions office will contact you soon.</p>
            <div className="row" style={{ justifyContent: "center" }}>
              <Link className="btn" to={`/apply/track?reference=${done}`}>Track my application</Link>
              <Link className="btn btn-outline" to="/">Back to the homepage</Link>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page-enter">
      <PageHero title="Apply online" intro="It takes about five minutes. We'll email you a reference number straight away." />
      <section className="section">
        <div className="narrow">
          {institution && !institution.enrolmentOpen && <Alert tone="warning">Enrolment is closed at the moment, but you can still apply for the next intake.</Alert>}
          {placement && <Alert tone="success">Your placement test recommended level <strong>{placement.level}</strong>. We've filled it in for you.</Alert>}
          <form className="form-card" onSubmit={submit} noValidate>
            <ErrorNote error={error} />
            <h2>About you</h2>
            <div className="form-grid">
              <TextField label="Full name" required value={form.name} onChange={set("name")} autoComplete="name" />
              <TextField label="Email" type="email" required value={form.email} onChange={set("email")} autoComplete="email" error={error?.message.includes("email") ? error.message : undefined} />
              <TextField label="Phone (WhatsApp if possible)" type="tel" required value={form.phone} onChange={set("phone")} autoComplete="tel" placeholder="+265 …" />
              <TextField label="Date of birth" type="date" value={form.dateOfBirth} onChange={set("dateOfBirth")} max={new Date().toISOString().slice(0, 10)} />
              <SelectField label="Gender" value={form.gender} onChange={set("gender")} options={["Female", "Male", "Prefer not to say"]} placeholder="Choose…" />
              <TextField label="Nationality" value={form.nationality} onChange={set("nationality")} />
              <TextArea label="Address" className="span-all" value={form.address} onChange={set("address")} rows={2} />
            </div>

            <h2>Your course</h2>
            <div className="form-grid">
              <SelectField
                label="Course"
                required
                value={form.course}
                onChange={set("course")}
                placeholder="Choose a course…"
                options={[...(courses.data ?? []).map((c) => ({ value: c.title, label: `${c.title}${c.feeText ? ` — ${c.feeText}` : ""}` })), { value: "Not sure yet", label: "Not sure yet — please advise me" }]}
              />
              <SelectField label="Level" required value={form.level} onChange={set("level")} options={LEVELS} hint={<Link to="/placement-test">Not sure? Take the free placement test.</Link>} />
              <SelectField label="Preferred time" value={form.preferredSchedule} onChange={set("preferredSchedule")} options={["Morning", "Afternoon", "Evening", "Weekend", "Online"]} placeholder="Any time" />
              <SelectField label="How did you hear about us?" value={form.source} onChange={set("source")} options={["Friend or family", "Facebook", "WhatsApp", "Radio", "School visit", "Poster", "Other"]} placeholder="Choose…" />
              <TextArea label="Why do you want to learn this language?" className="span-all" value={form.motivation} onChange={set("motivation")} rows={3} />
            </div>

            <h2>Guardian (for students under 18)</h2>
            <div className="form-grid">
              <TextField label="Guardian name" value={form.guardianName} onChange={set("guardianName")} />
              <TextField label="Guardian phone" type="tel" value={form.guardianPhone} onChange={set("guardianPhone")} />
            </div>

            {institution && institution.applicationFee > 0 && (
              <>
                <h2>Application fee</h2>
                <p className="muted small">The application fee is {money(institution.applicationFee, institution.currency)}. {institution.paymentInstructions}</p>
                <FileField label="Proof of payment (photo or PDF)" value={proof} onChange={setProof} realm="public" accept="image/*,application/pdf" />
              </>
            )}
            <input className="honeypot" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} aria-hidden />
            <p className="small muted">By applying you agree that we store your details to handle your application. Submitted on {date(new Date())}.</p>
            <div className="form-actions">
              <Button type="submit" variant="gold" size="lg" loading={busy} disabled={!form.name || !form.email || !form.phone || !form.course}>Send application</Button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

export function TrackApplication() {
  const [params] = useSearchParams();
  const [reference, setReference] = useState(params.get("reference") ?? "");
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<{ reference: string; name: string; course: string; level: string; status: string; createdAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  usePageMeta("Track my application");
  const steps = ["pending", "reviewing", "accepted"];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await api.post("/public/applications/track", { reference, email }));
    } catch (err) {
      setError(err as Error);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-enter">
      <PageHero title="Track my application" intro="Enter the reference number from your email and the email address you applied with." />
      <section className="section">
        <div className="narrow stack">
          <form className="form-card" onSubmit={submit}>
            <ErrorNote error={error} />
            <div className="form-grid">
              <TextField label="Reference" required value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} placeholder="APP-…" />
              <TextField label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="form-actions"><Button loading={busy} type="submit">Check status</Button></div>
          </form>
          {result && (
            <div className="form-card">
              <h2>{result.name}</h2>
              <p className="muted">{result.course} · {result.level} · applied {date(result.createdAt)}</p>
              {["waitlisted", "rejected"].includes(result.status) ? (
                <Alert tone={result.status === "rejected" ? "danger" : "warning"}>
                  {result.status === "rejected" ? "Unfortunately we couldn't offer a place this time. Please contact us to discuss other options." : "You're on the waiting list. We'll contact you as soon as a place opens."}
                </Alert>
              ) : (
                <div className="steps">
                  {steps.map((step) => (
                    <div className="step" key={step} style={{ opacity: steps.indexOf(step) <= steps.indexOf(result.status) ? 1 : 0.45 }}>
                      <strong>{step === "pending" ? "Received" : step === "reviewing" ? "Being reviewed" : "Accepted"}</strong>
                      <p className="small muted" style={{ margin: 0 }}>{step === "accepted" ? "Check your email to open your student portal." : step === "reviewing" ? "The admissions office is looking at your application." : "We have your application."}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
