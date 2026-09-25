import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Confirm, Empty, ErrorNote, Loading, PageHead } from "@/components/ui";
import { RichText } from "@/components/RichText";
import { useToast } from "@/components/Toasts";
import { useData, usePageMeta } from "@/hooks/useData";
import { api } from "@/services/api";
import { dateTime } from "@/lib/format";

interface ExamSummary { id: string; title: string; description: string | null; opensAt: string | null; closesAt: string | null; durationMinutes: number; passMark: number; class: { name: string } | null; attempt: { startedAt: string; submittedAt: string | null; percentage: number | null; passed: boolean | null; needsReview: boolean; feedback: string | null } | null }

export default function Exams() {
  const { data, loading } = useData<ExamSummary[]>("/me/exams", ["exams"]);
  usePageMeta("Exams & quizzes");
  if (loading) return <Loading />;
  const now = Date.now();
  return (
    <>
      <PageHead title="Exams & quizzes" />
      {data?.length ? (
        <div className="stack">
          {data.map((e) => {
            const notYet = e.opensAt && new Date(e.opensAt).getTime() > now;
            const closed = e.closesAt && new Date(e.closesAt).getTime() < now;
            const done = e.attempt?.submittedAt;
            return (
              <article key={e.id} className="card row-between">
                <div>
                  <h3 style={{ margin: 0 }}>{e.title}</h3>
                  <p className="muted small" style={{ margin: ".2rem 0" }}>{e.class?.name} · {e.durationMinutes} minutes{e.opensAt ? ` · opens ${dateTime(e.opensAt)}` : ""}{e.closesAt ? ` · closes ${dateTime(e.closesAt)}` : ""}</p>
                  {done && e.attempt?.feedback && <p className="small" style={{ margin: 0 }}>{e.attempt.feedback}</p>}
                </div>
                {done ? (
                  e.attempt!.needsReview ? <span className="badge badge-info">Being marked</span> : <span className={`badge ${e.attempt!.passed ? "badge-success" : "badge-danger"}`}>{e.attempt!.percentage}% · {e.attempt!.passed ? "Passed" : "Not passed"}</span>
                ) : notYet ? <span className="badge">Opens {dateTime(e.opensAt)}</span> : closed ? <span className="badge">Closed</span> : (
                  <Link className="btn btn-gold" to={`/portal/exams/${e.id}`}>{e.attempt ? "Continue" : "Start"}</Link>
                )}
              </article>
            );
          })}
        </div>
      ) : <div className="card"><Empty icon="check-square" title="No exams yet" /></div>}
    </>
  );
}

interface Question { id: string; type: "choice" | "multi" | "truefalse" | "short" | "essay"; prompt: string; options?: string[]; points: number }
interface Paper { exam: { id: string; title: string; description: string | null; durationMinutes: number }; questions: Question[]; answers: Record<string, unknown>; startedAt: string; deadline: string }

/**
 * Taking an exam. The clock comes from the server (it keeps running if the page is closed), answers
 * are saved every few seconds while typing, and the paper is handed in automatically when time runs out.
 */
export function TakeExam() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [paper, setPaper] = useState<Paper | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<Error | null>(null);
  const [left, setLeft] = useState<number>(0);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<"saved" | "saving" | "offline">("saved");
  const dirty = useRef(false);
  const submitted = useRef(false);
  usePageMeta(paper?.exam.title ?? "Exam");

  useEffect(() => {
    api.post<Paper>(`/me/exams/${id}/start`).then((p) => {
      setPaper(p);
      setAnswers(p.answers ?? {});
    }).catch(setError);
  }, [id]);

  const save = useCallback(async (submit: boolean) => {
    if (!paper || submitted.current) return;
    if (submit) submitted.current = true;
    setSaved("saving");
    try {
      const result = await api.put<{ submitted?: boolean; needsReview?: boolean; percentage?: number | null }>(`/me/exams/${paper.exam.id}`, { answers, submit });
      dirty.current = false;
      setSaved("saved");
      if (result.submitted) {
        toast(result.needsReview ? "Handed in. Your teacher will mark the written answers." : `Handed in. Your score: ${result.percentage}%`);
        navigate("/portal/exams", { replace: true });
      }
    } catch (err) {
      if (submit) submitted.current = false;
      setSaved("offline");
      if (submit) setError(err as Error);
    }
  }, [paper, answers, navigate, toast]);

  // Autosave a few seconds after the last change.
  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(() => void save(false), 4000);
    return () => clearTimeout(timer);
  }, [answers, save]);

  // Countdown; hand in automatically at zero.
  useEffect(() => {
    if (!paper) return;
    const tick = () => {
      const remaining = Math.max(0, Math.floor((new Date(paper.deadline).getTime() - Date.now()) / 1000));
      setLeft(remaining);
      if (remaining === 0 && !submitted.current) void save(true);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [paper, save]);

  // Warn before leaving with unsaved answers.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current && !submitted.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const set = (qid: string, value: unknown) => {
    dirty.current = true;
    setAnswers((a) => ({ ...a, [qid]: value }));
  };

  if (error && !paper) return <><ErrorNote error={error} /><Link to="/portal/exams" className="btn btn-outline">Back to exams</Link></>;
  if (!paper) return <Loading />;
  const minutes = Math.floor(left / 60);
  const seconds = left % 60;
  const answered = paper.questions.filter((q) => answers[q.id] !== undefined && answers[q.id] !== "" && !(Array.isArray(answers[q.id]) && !(answers[q.id] as unknown[]).length)).length;

  return (
    <>
      <PageHead title={paper.exam.title} />
      <div className="exam-bar">
        <span className="small muted">{answered}/{paper.questions.length} answered · {saved === "saving" ? "Saving…" : saved === "offline" ? "Not saved — check your connection" : "Saved"}</span>
        <span className={`timer ${left < 120 ? "low" : ""}`} aria-live="polite">{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}</span>
        <Button variant="gold" size="sm" onClick={() => setConfirm(true)}>Hand in</Button>
      </div>
      {paper.exam.description && <Alert><RichText text={paper.exam.description} /></Alert>}
      <ErrorNote error={error} />
      {paper.questions.map((q, i) => (
        <fieldset className="question" key={q.id}>
          <legend>{i + 1}. {q.prompt} <span className="muted small">({q.points} point{q.points === 1 ? "" : "s"})</span></legend>
          {q.type === "choice" && q.options?.map((o, oi) => (
            <label className="option" key={oi}><input type="radio" name={q.id} checked={answers[q.id] === oi} onChange={() => set(q.id, oi)} /><span>{o}</span></label>
          ))}
          {q.type === "multi" && q.options?.map((o, oi) => {
            const chosen = (answers[q.id] as number[] | undefined) ?? [];
            return (
              <label className="option" key={oi}><input type="checkbox" checked={chosen.includes(oi)} onChange={(e) => set(q.id, e.target.checked ? [...chosen, oi] : chosen.filter((x) => x !== oi))} /><span>{o}</span></label>
            );
          })}
          {q.type === "truefalse" && [true, false].map((v) => (
            <label className="option" key={String(v)}><input type="radio" name={q.id} checked={answers[q.id] === v} onChange={() => set(q.id, v)} /><span>{v ? "True" : "False"}</span></label>
          ))}
          {q.type === "short" && <input className="input" value={(answers[q.id] as string) ?? ""} onChange={(e) => set(q.id, e.target.value)} aria-label={`Answer ${i + 1}`} />}
          {q.type === "essay" && <textarea className="textarea" rows={6} value={(answers[q.id] as string) ?? ""} onChange={(e) => set(q.id, e.target.value)} aria-label={`Answer ${i + 1}`} />}
        </fieldset>
      ))}
      <div className="form-actions"><Button variant="gold" size="lg" onClick={() => setConfirm(true)}>Hand in</Button></div>
      {confirm && (
        <Confirm title="Hand in now?" message={answered < paper.questions.length ? `You've answered ${answered} of ${paper.questions.length} questions. You can't change your answers afterwards.` : "You can't change your answers afterwards."} confirmLabel="Hand in" busy={busy} onClose={() => setConfirm(false)} onConfirm={() => { setBusy(true); void save(true).finally(() => setBusy(false)); }} />
      )}
    </>
  );
}
