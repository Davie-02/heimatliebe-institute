import { useState, type FormEvent } from "react";
import { PageHero } from "./PageHero";
import { Alert, Button, ErrorNote, TextArea, TextField } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useSite } from "@/context/SiteContext";
import { usePageMeta } from "@/hooks/useData";
import { api } from "@/services/api";

export default function Contact() {
  const { content } = useSite();
  const site = content?.site;
  const [form, setForm] = useState({ name: "", email: "", phone: "", interest: "", message: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  usePageMeta("Contact us", "Visit, call, WhatsApp or write to Heimatliebe Institute in Karonga.");
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v));
      await api.post("/public/enquiries", body);
      setSent(true);
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-enter">
      <PageHero title="Contact us" intro="We usually reply within one working day." />
      <section className="section">
        <div className="container split">
          <div className="stack">
            <div className="tile"><span className="tile-icon"><Icon name="map-pin" /></span><h3>Visit</h3><p>{site?.contactAddress}</p></div>
            <div className="tile"><span className="tile-icon"><Icon name="phone" /></span><h3>Call or WhatsApp</h3><p><a href={`tel:${site?.contactPhone.replace(/\s/g, "")}`}>{site?.contactPhone}</a></p></div>
            <div className="tile"><span className="tile-icon"><Icon name="mail" /></span><h3>Email</h3><p><a href={`mailto:${site?.contactEmail}`}>{site?.contactEmail}</a></p></div>
            <div className="tile"><span className="tile-icon"><Icon name="clock" /></span><h3>Office hours</h3><p style={{ whiteSpace: "pre-line" }}>{site?.officeHours}</p></div>
            {site?.mapUrl && <a className="btn btn-outline" href={site.mapUrl} target="_blank" rel="noopener noreferrer"><Icon name="map-pin" /> Open in maps</a>}
          </div>
          <div className="form-card">
            {sent ? (
              <Alert tone="success">Thank you — your message has reached the admissions office. We'll be in touch soon.</Alert>
            ) : (
              <form onSubmit={submit}>
                <h2>Send us a message</h2>
                <ErrorNote error={error} />
                <div className="form-grid">
                  <TextField label="Name" required value={form.name} onChange={set("name")} autoComplete="name" />
                  <TextField label="Phone" type="tel" value={form.phone} onChange={set("phone")} autoComplete="tel" />
                  <TextField label="Email" type="email" value={form.email} onChange={set("email")} autoComplete="email" hint="Leave a phone number or email so we can reply." />
                  <TextField label="Interested in" value={form.interest} onChange={set("interest")} placeholder="e.g. German A1 evening class" />
                  <TextArea label="Message" required className="span-all" value={form.message} onChange={set("message")} rows={5} />
                </div>
                <input className="honeypot" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} aria-hidden />
                <div className="form-actions"><Button type="submit" loading={busy} disabled={!form.name || !form.message || (!form.email && !form.phone)}>Send message</Button></div>
              </form>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
