import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, Button, Empty, ErrorNote, Loading, PageHead, SelectField, TextArea, TextField } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/Toasts";
import { useData, usePageMeta } from "@/hooks/useData";
import { api, ApiError } from "@/services/api";
import { toDateTimeInput } from "@/lib/format";

type QType = "choice" | "multi" | "truefalse" | "short" | "essay";
interface Question { id: string; type: QType; prompt: string; options?: string[]; answer?: number | number[] | boolean | string; points: number }
interface Exam { id: string; classId: string; title: string; description: string | null; opensAt: string | null; closesAt: string | null; durationMinutes: number; passMark: number; published: boolean; questions: Question[] }

const TYPE_LABELS: Record<QType, string> = { choice: "Single choice", multi: "Multiple choice", truefalse: "True / false", short: "Short answer", essay: "Written answer (marked by you)" };
const newId = () => `q${Math.random().toString(36).slice(2, 8)}`;

/** Build an exam: settings plus a list of questions. Choice, true/false and short answers are marked automatically. */
export default function ExamBuilder() {
  const { examId } = useParams();
  const toast = useToast();
  const { data, loading, error } = useData<Exam>(`/teaching/exams/${examId}`);
  const [exam, setExam] = useState<Exam | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  usePageMeta(exam?.title ?? "Exam builder");
  useEffect(() => {
    if (data) setExam(data);
  }, [data]);

  if (loading || !exam) return error ? <ErrorNote error={error} /> : <Loading />;
  const update = (patch: Partial<Exam>) => setExam({ ...exam, ...patch });
  const setQuestion = (index: number, patch: Partial<Question>) => update({ questions: exam.questions.map((q, i) => (i === index ? { ...q, ...patch } : q)) });
  const move = (index: number, by: number) => {
    const list = [...exam.questions];
    const [item] = list.splice(index, 1);
    list.splice(Math.max(0, Math.min(list.length, index + by)), 0, item);
    update({ questions: list });
  };
  const add = (type: QType) => update({ questions: [...exam.questions, { id: newId(), type, prompt: "", points: type === "essay" ? 5 : 1, ...(type === "choice" || type === "multi" ? { options: ["", ""], answer: type === "choice" ? 0 : [] } : type === "truefalse" ? { answer: true } : type === "short" ? { answer: "" } : {}) }] });
  const total = exam.questions.reduce((sum, q) => sum + (Number(q.points) || 0), 0);

  async function save(publish?: boolean) {
    setBusy(true);
    setSaveError(null);
    try {
      const saved = await api.put<Exam>(`/teaching/exams/${exam!.id}`, {
        title: exam!.title,
        description: exam!.description || undefined,
        opensAt: exam!.opensAt ? new Date(exam!.opensAt).toISOString() : undefined,
        closesAt: exam!.closesAt ? new Date(exam!.closesAt).toISOString() : undefined,
        durationMinutes: Number(exam!.durationMinutes),
        passMark: Number(exam!.passMark),
        published: publish ?? exam!.published,
        questions: exam!.questions.map((q) => ({ ...q, points: Number(q.points) })),
      });
      setExam(saved);
      toast(publish ? "Saved and opened to students." : "Saved.");
    } catch (err) {
      setSaveError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="breadcrumb" style={{ marginBottom: ".5rem" }}><Link to={`/admin/teaching/${exam.classId}`}><Icon name="chevron-left" /> Class</Link></div>
      <PageHead
        title="Exam builder"
        description={`${exam.questions.length} questions · ${total} points`}
        actions={
          <>
            <Link className="btn btn-outline" to={`/admin/teaching/exams/${exam.id}/marking`}>Results</Link>
            <Button variant="outline" loading={busy} onClick={() => void save()}>Save</Button>
            {!exam.published ? <Button variant="gold" loading={busy} onClick={() => void save(true)}>Save & open to students</Button> : <Button variant="outline" loading={busy} onClick={() => void save(false)}>Close to students</Button>}
          </>
        }
      />
      {saveError && <Alert tone="danger">{saveError.message}{saveError.problems && <ul>{saveError.problems.map((p) => <li key={p}>{p}</li>)}</ul>}</Alert>}
      <section className="card" style={{ marginBottom: "1rem" }}>
        <div className="form-grid">
          <TextField label="Title" value={exam.title} onChange={(e) => update({ title: e.target.value })} className="span-all" />
          <TextArea label="Instructions" className="span-all" rows={3} value={exam.description ?? ""} onChange={(e) => update({ description: e.target.value })} />
          <TextField label="Opens" type="datetime-local" value={toDateTimeInput(exam.opensAt)} onChange={(e) => update({ opensAt: e.target.value || null })} />
          <TextField label="Closes" type="datetime-local" value={toDateTimeInput(exam.closesAt)} onChange={(e) => update({ closesAt: e.target.value || null })} />
          <TextField label="Time allowed (minutes)" type="number" min="1" value={String(exam.durationMinutes)} onChange={(e) => update({ durationMinutes: Number(e.target.value) })} />
          <TextField label="Pass mark (%)" type="number" min="0" max="100" value={String(exam.passMark)} onChange={(e) => update({ passMark: Number(e.target.value) })} />
        </div>
      </section>
      {exam.questions.map((q, index) => (
        <div key={q.id} className="builder-q">
          <div className="row-between">
            <strong>Question {index + 1} · {TYPE_LABELS[q.type]}</strong>
            <div className="row">
              <TextField label="Points" type="number" min="1" value={String(q.points)} onChange={(e) => setQuestion(index, { points: Number(e.target.value) })} className="" />
              <button className="icon-btn" onClick={() => move(index, -1)} aria-label="Move up" disabled={index === 0}><Icon name="arrow-up" /></button>
              <button className="icon-btn" onClick={() => move(index, 1)} aria-label="Move down" disabled={index === exam.questions.length - 1}><Icon name="chevron-down" /></button>
              <button className="icon-btn" onClick={() => update({ questions: exam.questions.filter((_, i) => i !== index) })} aria-label="Delete question"><Icon name="trash" /></button>
            </div>
          </div>
          <TextArea label="Question" rows={2} value={q.prompt} onChange={(e) => setQuestion(index, { prompt: e.target.value })} />
          {(q.type === "choice" || q.type === "multi") && (
            <div>
              <span className="label">Options — tick the correct {q.type === "choice" ? "one" : "ones"}</span>
              {q.options?.map((option, oi) => {
                const correct = q.type === "choice" ? q.answer === oi : Array.isArray(q.answer) && q.answer.includes(oi);
                return (
                  <div className="opt-row" key={oi}>
                    <input
                      type={q.type === "choice" ? "radio" : "checkbox"}
                      name={`correct-${q.id}`}
                      checked={correct}
                      aria-label="Correct answer"
                      onChange={(e) => setQuestion(index, { answer: q.type === "choice" ? oi : e.target.checked ? [...((q.answer as number[]) ?? []), oi] : ((q.answer as number[]) ?? []).filter((x) => x !== oi) })}
                    />
                    <input className="input" value={option} placeholder={`Option ${oi + 1}`} onChange={(e) => setQuestion(index, { options: q.options!.map((o, i) => (i === oi ? e.target.value : o)) })} />
                    <button className="icon-btn" aria-label="Remove option" onClick={() => setQuestion(index, { options: q.options!.filter((_, i) => i !== oi), answer: q.type === "choice" ? 0 : ((q.answer as number[]) ?? []).filter((x) => x !== oi).map((x) => (x > oi ? x - 1 : x)) })}><Icon name="x" /></button>
                  </div>
                );
              })}
              <Button size="sm" variant="ghost" icon="plus" onClick={() => setQuestion(index, { options: [...(q.options ?? []), ""] })}>Add option</Button>
            </div>
          )}
          {q.type === "truefalse" && <SelectField label="Correct answer" value={String(q.answer)} onChange={(e) => setQuestion(index, { answer: e.target.value === "true" })} options={[{ value: "true", label: "True" }, { value: "false", label: "False" }]} />}
          {q.type === "short" && <TextField label="Accepted answers" value={String(q.answer ?? "")} onChange={(e) => setQuestion(index, { answer: e.target.value })} hint="Separate several with |, e.g. Kinder|die Kinder. Capitals and end punctuation are ignored." />}
          {q.type === "essay" && <p className="muted small">You'll mark this under Results.</p>}
        </div>
      ))}
      <div className="card row">
        <strong>Add a question:</strong>
        {(Object.keys(TYPE_LABELS) as QType[]).map((type) => <Button key={type} size="sm" variant="outline" icon="plus" onClick={() => add(type)}>{TYPE_LABELS[type]}</Button>)}
      </div>
    </>
  );
}

interface Attempts { exam: Exam; attempts: Array<{ id: string; student: { id: string; name: string; studentNo: string }; given: Record<string, unknown>; marks: Record<string, number>; percentage: number | null; score: number | null; total: number | null; passed: boolean | null; needsReview: boolean; submittedAt: string | null; feedback: string | null }> }

/** Results of an exam, and marking the written answers. */
export function Marking() {
  const { examId } = useParams();
  const toast = useToast();
  const { data, loading, reload } = useData<Attempts>(`/teaching/exams/${examId}/attempts`, ["exams"]);
  const [open, setOpen] = useState<string | null>(null);
  const [marks, setMarks] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState("");
  usePageMeta("Exam results");
  if (loading || !data) return <Loading />;
  const current = data.attempts.find((a) => a.id === open);
  const manual = data.exam.questions.filter((q) => q.type === "essay");

  async function save() {
    try {
      await api.post(`/teaching/attempts/${open}/mark`, { marks, feedback: feedback || undefined });
      toast("Marks saved.");
      setOpen(null);
      void reload();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  const answerText = (q: Question, given: unknown) => {
    if (given === undefined || given === "") return <span className="faint">No answer</span>;
    if (q.type === "choice") return q.options?.[Number(given)] ?? "—";
    if (q.type === "multi") return (given as number[]).map((i) => q.options?.[i]).join(", ");
    if (q.type === "truefalse") return given ? "True" : "False";
    return <span style={{ whiteSpace: "pre-wrap" }}>{String(given)}</span>;
  };

  return (
    <>
      <div className="breadcrumb" style={{ marginBottom: ".5rem" }}><Link to={`/admin/teaching/exams/${examId}`}><Icon name="chevron-left" /> Exam builder</Link></div>
      <PageHead title={`Results: ${data.exam.title}`} description={`${data.attempts.filter((a) => a.submittedAt).length} handed in · pass mark ${data.exam.passMark}%`} actions={<Button variant="outline" icon="printer" onClick={() => window.print()}>Print</Button>} />
      {data.attempts.length ? (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>Student</th><th>Handed in</th><th className="num">Score</th><th>Result</th><th /></tr></thead>
            <tbody>
              {data.attempts.map((a) => (
                <tr key={a.id}>
                  <td data-label="Student">{a.student.name}</td>
                  <td data-label="Handed in">{a.submittedAt ? new Date(a.submittedAt).toLocaleString("en-GB") : <span className="badge">In progress</span>}</td>
                  <td data-label="Score" className="num">{a.needsReview ? "—" : `${a.score}/${a.total} (${a.percentage}%)`}</td>
                  <td data-label="Result">{a.needsReview ? <span className="badge badge-warning">Needs marking</span> : a.passed === null ? "—" : <span className={`badge ${a.passed ? "badge-success" : "badge-danger"}`}>{a.passed ? "Passed" : "Not passed"}</span>}</td>
                  <td>{a.submittedAt && <Button size="sm" variant={a.needsReview ? "" : "outline"} onClick={() => { setOpen(a.id); setMarks(a.marks ?? {}); setFeedback(a.feedback ?? ""); }}>{a.needsReview ? "Mark" : "View"}</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="card"><Empty icon="check-square" title="Nobody has taken this exam yet" /></div>}
      {current && (
        <section className="card" style={{ marginTop: "1rem" }}>
          <div className="row-between"><h2>{current.student.name}</h2><Button variant="ghost" onClick={() => setOpen(null)}>Close</Button></div>
          {data.exam.questions.map((q, i) => (
            <div key={q.id} className="builder-q">
              <strong>{i + 1}. {q.prompt}</strong> <span className="muted small">({q.points} pts)</span>
              <div style={{ margin: ".5rem 0" }}>{answerText(q, current.given[q.id])}</div>
              {q.type === "essay" ? (
                <TextField label={`Mark (0–${q.points})`} type="number" min="0" max={q.points} step="0.5" value={marks[q.id]?.toString() ?? ""} onChange={(e) => setMarks({ ...marks, [q.id]: Number(e.target.value) })} />
              ) : <span className="muted small">Marked automatically</span>}
            </div>
          ))}
          <TextArea label="Feedback to the student" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
          {manual.some((q) => marks[q.id] === undefined) && <Alert tone="warning">Give a mark for every written answer to release the result.</Alert>}
          <div className="form-actions"><Button onClick={() => void save()}>Save marks</Button></div>
        </section>
      )}
    </>
  );
}
