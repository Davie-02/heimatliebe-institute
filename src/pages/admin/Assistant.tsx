import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, Empty, Loading, PageHead, Tabs, TextArea, TextField } from "@/components/ui";
import { useToast } from "@/components/Toasts";
import { useStaff } from "@/context/AuthContext";
import { useData, usePageMeta } from "@/hooks/useData";
import { can } from "@/admin/access";
import { api } from "@/services/api";
import { relative } from "@/lib/format";

interface Stats { enabled: boolean; name: string; models: string[]; last30Days: { total: number; unanswered: number; direct: number }; drafts: number }
interface Suggestion { id: string; question: string; answer: string; asked: number; status: string }
interface Log { id: string; question: string; answer: string | null; answered: boolean; source: string | null; createdAt: string }

/** The website assistant: how it's doing, what visitors asked, and FAQ answers it drafted for review. */
export default function Assistant() {
  const user = useStaff();
  const toast = useToast();
  const stats = useData<Stats>("/assistant/admin/stats", ["faq-suggestions"]);
  const suggestions = useData<Suggestion[]>("/assistant/admin/suggestions", ["faq-suggestions"]);
  const [tab, setTab] = useState<"suggestions" | "questions" | "try">("suggestions");
  const [onlyUnanswered, setOnlyUnanswered] = useState(true);
  const logs = useData<Log[]>(tab === "questions" ? `/assistant/admin/logs?unanswered=${onlyUnanswered}` : null);
  const [edits, setEdits] = useState<Record<string, { question: string; answer: string; category: string }>>({});
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("");
  const [reply, setReply] = useState<{ answer: string; answered: boolean } | null>(null);
  const editor = can(user, "assistant", "edit");
  usePageMeta("Website assistant");

  async function refresh() {
    setBusy(true);
    try {
      const r = await api.post<{ created: number }>("/assistant/admin/suggestions/refresh");
      toast(r.created ? `${r.created} new suggestion(s).` : "No new repeated questions right now.");
      void suggestions.reload();
    } finally {
      setBusy(false);
    }
  }
  async function publish(s: Suggestion) {
    const e = edits[s.id] ?? { question: s.question, answer: s.answer, category: "" };
    try {
      await api.post(`/assistant/admin/suggestions/${s.id}/publish`, { question: e.question, answer: e.answer, category: e.category || undefined });
      toast("Added to the FAQ.");
      void suggestions.reload();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }
  async function dismiss(id: string) {
    await api.post(`/assistant/admin/suggestions/${id}/dismiss`);
    void suggestions.reload();
  }
  async function tryIt(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      setReply(await api.post("/assistant/admin/test", { message: question }));
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (stats.loading || !stats.data) return <Loading />;
  const s = stats.data;
  return (
    <>
      <PageHead title="Website assistant" description="Answers visitors' questions using only your courses, fees, FAQ, exam dates, contact details and knowledge notes." actions={<Link className="btn btn-outline" to="/admin/r/knowledge">What it knows</Link>} />
      {!s.enabled && <Alert tone="warning">The assistant is switched off. It appears on the website once a free Gemini key is set as GEMINI_API_KEY on the server (see the deployment guide).</Alert>}
      <div className="kpis">
        <div className="kpi"><span className="stat-label">Questions (30 days)</span><span className="stat-value">{s.last30Days.total}</span></div>
        <div className="kpi"><span className="stat-label">Answered straight from the FAQ</span><span className="stat-value">{s.last30Days.direct}</span></div>
        <div className="kpi alert-kpi"><span className="stat-label">It couldn't answer</span><span className="stat-value">{s.last30Days.unanswered}</span></div>
        <div className="kpi"><span className="stat-label">Suggested FAQ answers</span><span className="stat-value">{s.drafts}</span></div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "suggestions", label: "Suggested FAQ" }, { value: "questions", label: "What visitors asked" }, { value: "try", label: "Try it" }]} />
      {tab === "suggestions" && (
        <>
          <div className="row-between" style={{ marginBottom: "1rem" }}><p className="muted small" style={{ margin: 0 }}>Questions asked several times that the FAQ doesn't cover yet, with a drafted answer. Check, edit and publish.</p>{editor && <Button variant="outline" size="sm" icon="refresh" loading={busy} onClick={() => void refresh()}>Check now</Button>}</div>
          {suggestions.data?.length ? (
            <div className="stack">
              {suggestions.data.map((sug) => {
                const e = edits[sug.id] ?? { question: sug.question, answer: sug.answer, category: "" };
                const set = (patch: Partial<typeof e>) => setEdits({ ...edits, [sug.id]: { ...e, ...patch } });
                return (
                  <article key={sug.id} className="card">
                    <span className="badge badge-info">Asked {sug.asked} times</span>
                    <TextField label="Question" value={e.question} onChange={(ev) => set({ question: ev.target.value })} disabled={!editor} />
                    <TextArea label="Answer" value={e.answer} onChange={(ev) => set({ answer: ev.target.value })} disabled={!editor} placeholder="The assistant couldn't draft this from what it knows — write the answer." />
                    {editor && <div className="row"><Button size="sm" onClick={() => void publish(sug)} disabled={!e.answer.trim()}>Publish to FAQ</Button><Button size="sm" variant="ghost" onClick={() => void dismiss(sug.id)}>Dismiss</Button></div>}
                  </article>
                );
              })}
            </div>
          ) : <div className="card"><Empty icon="check-circle" title="No suggestions right now" /></div>}
        </>
      )}
      {tab === "questions" && (
        <>
          <div className="row" style={{ marginBottom: "1rem" }}><label className="check"><input type="checkbox" checked={onlyUnanswered} onChange={(e) => setOnlyUnanswered(e.target.checked)} /> Only questions it couldn't answer</label></div>
          {logs.loading ? <Loading /> : logs.data?.length ? (
            <div className="card"><ul className="list">{logs.data.map((l) => <li key={l.id}><div><strong>{l.question}</strong>{l.answer && <div className="muted small">{l.answer.slice(0, 200)}</div>}</div><span className="muted small">{relative(l.createdAt)}</span></li>)}</ul></div>
          ) : <div className="card"><Empty title="Nothing yet" /></div>}
          <p className="muted small">Emails and phone numbers are removed before questions are stored, and questions are deleted after 90 days.</p>
        </>
      )}
      {tab === "try" && (
        <form className="card" onSubmit={tryIt}>
          <TextField label="Ask something a visitor might ask" value={question} onChange={(e) => setQuestion(e.target.value)} />
          <div className="form-actions"><Button type="submit" loading={busy} disabled={!question.trim()}>Ask</Button></div>
          {reply && <Alert tone={reply.answered ? "success" : "warning"}><span style={{ whiteSpace: "pre-line" }}>{reply.answer}</span></Alert>}
        </form>
      )}
    </>
  );
}
