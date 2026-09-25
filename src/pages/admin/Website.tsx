import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, Check, ErrorNote, Loading, PageHead, SelectField, TextArea, TextField } from "@/components/ui";
import { FileField } from "@/components/FileField";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/Toasts";
import { useStaff } from "@/context/AuthContext";
import { useData, usePageMeta } from "@/hooks/useData";
import { can } from "@/admin/access";
import { api } from "@/services/api";
import type { Institution, SiteText } from "@/lib/types";

type Content = { site: SiteText; institution: Institution };
const GOAL_ICONS = ["graduation", "briefcase", "plane", "globe", "book", "sprout", "award", "users", "star", "target", "school", "compass"];

/** A list of small groups of fields (stats, goals, languages) that can be added, removed and reordered. */
function ListEditor<T extends Record<string, string>>({ label, items, onChange, fields, blank }: { label: string; items: T[]; onChange: (items: T[]) => void; fields: Array<{ key: keyof T & string; label: string; long?: boolean; options?: string[] }>; blank: T }) {
  return (
    <div className="field span-all">
      <span className="label">{label}</span>
      {items.map((item, index) => (
        <div key={index} className="builder-q">
          <div className="form-grid">
            {fields.map((f) =>
              f.options ? (
                <SelectField key={f.key} label={f.label} value={item[f.key]} options={f.options} onChange={(e) => onChange(items.map((it, i) => (i === index ? { ...it, [f.key]: e.target.value } : it)))} />
              ) : f.long ? (
                <TextArea key={f.key} label={f.label} className="span-all" rows={2} value={item[f.key]} onChange={(e) => onChange(items.map((it, i) => (i === index ? { ...it, [f.key]: e.target.value } : it)))} />
              ) : (
                <TextField key={f.key} label={f.label} value={item[f.key]} onChange={(e) => onChange(items.map((it, i) => (i === index ? { ...it, [f.key]: e.target.value } : it)))} />
              )
            )}
          </div>
          <div className="row">
            <Button type="button" size="sm" variant="ghost" icon="arrow-up" disabled={index === 0} onClick={() => { const next = [...items]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onChange(next); }}>Up</Button>
            <Button type="button" size="sm" variant="ghost" icon="trash" onClick={() => onChange(items.filter((_, i) => i !== index))}>Remove</Button>
          </div>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" icon="plus" onClick={() => onChange([...items, { ...blank }])}>Add</Button>
    </div>
  );
}

/** Homepage text, goals, languages and contact details. Saved changes appear on the website at once. */
export default function Website() {
  const user = useStaff();
  const toast = useToast();
  const { data, loading } = useData<Content>("/site-content", ["site-content"]);
  const [site, setSite] = useState<SiteText | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const editor = can(user, "website", "edit");
  usePageMeta("Homepage & contact");
  useEffect(() => {
    if (data && !site) setSite(data.site);
  }, [data, site]);
  if (loading || !site) return <Loading />;
  const set = <K extends keyof SiteText>(key: K, value: SiteText[K]) => setSite({ ...site, [key]: value });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.put("/site-content/site", site);
      toast("Saved. The website has been updated.");
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title="Homepage & contact" description="The words and pictures on the public website." actions={<><Link className="btn btn-outline" to="/" target="_blank"><Icon name="external" /> View website</Link>{editor && <Button loading={busy} onClick={() => void save()}>Save changes</Button>}</>} />
      {!editor && <Alert>You can view this page; ask for Website edit access to change it.</Alert>}
      <ErrorNote error={error} />
      <fieldset disabled={!editor} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <section className="card">
          <h2>Top of the homepage</h2>
          <div className="form-grid">
            <TextField label="Small label above the headline" value={site.heroLabel} onChange={(e) => set("heroLabel", e.target.value)} />
            <TextField label="Headline words (separate with |)" value={site.heroWords.join(" | ")} onChange={(e) => set("heroWords", e.target.value.split("|").map((w) => w.trim()).filter(Boolean))} hint="The third word is shown large in gold." />
            <TextArea label="Tagline" className="span-all" rows={2} value={site.heroTagline} onChange={(e) => set("heroTagline", e.target.value)} />
          </div>
          <FileField label="Background photo (optional)" value={site.heroImage || null} onChange={(url) => set("heroImage", url ?? "")} accept="image/*" />
        </section>
        <section className="card">
          <h2>About</h2>
          <div className="form-grid">
            <TextField label="Title" className="span-all" value={site.aboutTitle} onChange={(e) => set("aboutTitle", e.target.value)} />
            <TextArea label="Text" className="span-all" rows={8} value={site.aboutBody} onChange={(e) => set("aboutBody", e.target.value)} hint="Leave a blank line between paragraphs." />
            <ListEditor label="Highlights" items={site.stats} onChange={(v) => set("stats", v)} fields={[{ key: "num", label: "Number" }, { key: "label", label: "Label" }]} blank={{ num: "", label: "" }} />
          </div>
        </section>
        <section className="card">
          <h2>Goals</h2>
          <div className="form-grid">
            <TextField label="Title" value={site.goalsTitle} onChange={(e) => set("goalsTitle", e.target.value)} />
            <TextField label="Introduction" value={site.goalsIntro} onChange={(e) => set("goalsIntro", e.target.value)} />
            <ListEditor label="Goals" items={site.goals} onChange={(v) => set("goals", v)} fields={[{ key: "icon", label: "Icon", options: GOAL_ICONS }, { key: "title", label: "Title" }, { key: "text", label: "Text", long: true }]} blank={{ icon: "star", title: "", text: "" }} />
          </div>
        </section>
        <section className="card">
          <h2>Languages</h2>
          <div className="form-grid">
            <TextField label="Title" value={site.languagesTitle} onChange={(e) => set("languagesTitle", e.target.value)} />
            <TextField label="Introduction" value={site.languagesIntro} onChange={(e) => set("languagesIntro", e.target.value)} />
            <ListEditor label="Languages" items={site.languages} onChange={(v) => set("languages", v)} fields={[{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "desc", label: "Description" }, { key: "status", label: "Status" }]} blank={{ code: "", name: "", desc: "", status: "Coming soon" }} />
          </div>
        </section>
        <section className="card">
          <h2>Vision</h2>
          <div className="form-grid">
            <TextField label="Title" className="span-all" value={site.visionTitle} onChange={(e) => set("visionTitle", e.target.value)} />
            <TextArea label="Text" className="span-all" rows={5} value={site.visionBody} onChange={(e) => set("visionBody", e.target.value)} />
            <TextArea label="Quote" className="span-all" rows={2} value={site.visionQuote} onChange={(e) => set("visionQuote", e.target.value)} />
          </div>
        </section>
        <section className="card">
          <h2>Contact & social media</h2>
          <div className="form-grid">
            <TextField label="Address" value={site.contactAddress} onChange={(e) => set("contactAddress", e.target.value)} />
            <TextField label="Phone" value={site.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} />
            <TextField label="Email" value={site.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} />
            <TextField label="Map link" value={site.mapUrl} onChange={(e) => set("mapUrl", e.target.value)} placeholder="https://maps.google.com/…" />
            <TextArea label="Office hours" rows={2} value={site.officeHours} onChange={(e) => set("officeHours", e.target.value)} />
            <TextField label="Facebook page" value={site.socialFacebook} onChange={(e) => set("socialFacebook", e.target.value)} />
            <TextField label="Instagram" value={site.socialInstagram} onChange={(e) => set("socialInstagram", e.target.value)} />
            <TextField label="TikTok" value={site.socialTiktok} onChange={(e) => set("socialTiktok", e.target.value)} />
            <TextField label="YouTube" value={site.socialYoutube} onChange={(e) => set("socialYoutube", e.target.value)} />
            <TextField label="Footer note" value={site.footerNote} onChange={(e) => set("footerNote", e.target.value)} />
          </div>
        </section>
      </fieldset>
      {editor && <div className="form-actions"><Button loading={busy} onClick={() => void save()}>Save changes</Button></div>}
    </>
  );
}

/** Institute-wide settings: name, currency, pass mark, fees and payment instructions. */
export function InstituteSettings() {
  const user = useStaff();
  const toast = useToast();
  const { data, loading } = useData<Content>("/site-content", ["site-content"]);
  const [inst, setInst] = useState<Institution | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const editor = can(user, "system", "edit");
  usePageMeta("Institute settings");
  useEffect(() => {
    if (data && !inst) setInst(data.institution);
  }, [data, inst]);
  if (loading || !inst) return <Loading />;
  const set = <K extends keyof Institution>(key: K, value: Institution[K]) => setInst({ ...inst, [key]: value });
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.put("/site-content/institution", { ...inst, passMark: Number(inst!.passMark), attendanceAlertThreshold: Number(inst!.attendanceAlertThreshold), applicationFee: Number(inst!.applicationFee) });
      toast("Settings saved.");
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHead title="Institute settings" actions={editor ? <Button loading={busy} onClick={() => void save()}>Save</Button> : undefined} />
      <ErrorNote error={error} />
      <fieldset disabled={!editor} style={{ border: 0, padding: 0, margin: 0 }}>
        <section className="card">
          <div className="form-grid">
            <TextField label="Institute name" value={inst.name} onChange={(e) => set("name", e.target.value)} />
            <TextField label="Short name" value={inst.shortName} onChange={(e) => set("shortName", e.target.value)} />
            <TextField label="Tagline" value={inst.tagline} onChange={(e) => set("tagline", e.target.value)} />
            <TextField label="Location" value={inst.location} onChange={(e) => set("location", e.target.value)} />
            <TextField label="Currency" value={inst.currency} onChange={(e) => set("currency", e.target.value)} />
            <TextField label="Current term" value={inst.currentTerm} onChange={(e) => set("currentTerm", e.target.value)} />
            <TextField label="Academic year" value={inst.academicYear} onChange={(e) => set("academicYear", e.target.value)} />
            <TextField label="Pass mark (%)" type="number" value={String(inst.passMark)} onChange={(e) => set("passMark", Number(e.target.value))} />
            <TextField label="Attendance warning below (%)" type="number" value={String(inst.attendanceAlertThreshold)} onChange={(e) => set("attendanceAlertThreshold", Number(e.target.value))} />
            <TextField label="Application fee (0 = none)" type="number" value={String(inst.applicationFee)} onChange={(e) => set("applicationFee", Number(e.target.value))} />
            <TextField label="WhatsApp number (digits, with country code)" value={inst.whatsappNumber} onChange={(e) => set("whatsappNumber", e.target.value.replace(/\D/g, ""))} />
            <TextField label="Languages taught (comma-separated)" value={inst.languages.join(", ")} onChange={(e) => set("languages", e.target.value.split(",").map((l) => l.trim()).filter(Boolean))} />
            <TextArea label="How to pay (shown to students and applicants)" className="span-all" rows={3} value={inst.paymentInstructions} onChange={(e) => set("paymentInstructions", e.target.value)} />
          </div>
          <Check label="Applications are open" checked={inst.enrolmentOpen} onChange={(e) => set("enrolmentOpen", e.target.checked)} />
        </section>
      </fieldset>
    </>
  );
}
