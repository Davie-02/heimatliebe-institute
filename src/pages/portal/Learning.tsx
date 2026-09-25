import { useState, type FormEvent } from "react";
import { Avatar, Button, Empty, ErrorNote, Loading, Modal, PageHead, SelectField, Status, TextArea } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { RichText } from "@/components/RichText";
import { FileField } from "@/components/FileField";
import { useToast } from "@/components/Toasts";
import { useStudent } from "@/context/AuthContext";
import { useData, usePageMeta } from "@/hooks/useData";
import { api, mediaUrl } from "@/services/api";
import { date, dateTime, WEEKDAYS } from "@/lib/format";

interface Slot { id: string; dayOfWeek: number; startTime: string; endTime: string; room: string | null }
interface MyClass { id: string; name: string; level: string | null; room: string | null; schedule: string | null; mode: string; meetingUrl: string | null; startDate: string | null; endDate: string | null; status: string; enrollment: string; evaluated: boolean; course: { title: string; language: string } | null; teacher: { id: string; name: string; photoUrl: string | null } | null; timetable: Slot[] }

export default function Classes() {
  const { data, loading } = useData<MyClass[]>("/me/classes", ["classes", "enrollments"]);
  const [evaluate, setEvaluate] = useState<MyClass | null>(null);
  usePageMeta("My classes");
  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="My classes" />
      {data?.length ? (
        <div className="grid-2">
          {data.map((c) => (
            <article key={c.id} className="card stack">
              <div className="row-between"><h2 style={{ margin: 0 }}>{c.name}</h2><Status value={c.enrollment === "active" ? c.status : c.enrollment} /></div>
              <p className="muted small" style={{ margin: 0 }}>{c.course?.title}{c.level ? ` · ${c.level}` : ""}{c.room ? ` · ${c.room}` : ""}{c.startDate ? ` · ${date(c.startDate)} – ${date(c.endDate)}` : ""}</p>
              {c.teacher && <div className="row"><Avatar name={c.teacher.name} src={c.teacher.photoUrl} /> <span>{c.teacher.name}<br /><span className="muted small">Teacher</span></span></div>}
              <ul className="list small">{c.timetable.map((s) => <li key={s.id}><span>{WEEKDAYS[s.dayOfWeek]}</span><span>{s.startTime}–{s.endTime}{s.room ? ` · ${s.room}` : ""}</span></li>)}</ul>
              <div className="row">
                {c.meetingUrl && <a className="btn btn-sm" href={c.meetingUrl} target="_blank" rel="noopener noreferrer"><Icon name="video" /> Online classroom</a>}
                {!c.evaluated && <Button size="sm" variant="outline" icon="star" onClick={() => setEvaluate(c)}>Give feedback</Button>}
              </div>
            </article>
          ))}
        </div>
      ) : <div className="card"><Empty icon="users" title="You're not in a class yet">The office will place you in a class soon.</Empty></div>}
      {evaluate && <Evaluate cls={evaluate} onClose={() => setEvaluate(null)} />}
    </>
  );
}

function Evaluate({ cls, onClose }: { cls: MyClass; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ courseRating: "5", teacherRating: "5", comments: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/me/classes/${cls.id}/evaluation`, { courseRating: Number(form.courseRating), teacherRating: Number(form.teacherRating), comments: form.comments || undefined });
      toast("Thank you for your feedback!");
      onClose();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }
  const stars = ["5", "4", "3", "2", "1"].map((v) => ({ value: v, label: `${"★".repeat(Number(v))}${"☆".repeat(5 - Number(v))}` }));
  return (
    <Modal title={`Feedback: ${cls.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted small">Your feedback helps us improve. Teachers see a summary, not your name.</p>
        <ErrorNote error={error} />
        <SelectField label="The course" options={stars} value={form.courseRating} onChange={(e) => setForm({ ...form, courseRating: e.target.value })} />
        <SelectField label="The teacher" options={stars} value={form.teacherRating} onChange={(e) => setForm({ ...form, teacherRating: e.target.value })} />
        <TextArea label="Anything else?" value={form.comments} onChange={(e) => setForm({ ...form, comments: e.target.value })} />
        <div className="form-actions"><Button type="submit" loading={busy}>Send feedback</Button></div>
      </form>
    </Modal>
  );
}

interface TimetableEntry extends Slot { class: { id: string; name: string; room: string | null; meetingUrl: string | null; mode: string; teacher: { name: string } | null } }

export function Timetable() {
  const { data, loading } = useData<TimetableEntry[]>("/me/timetable", ["timetable"]);
  usePageMeta("Timetable");
  const today = new Date().getDay();
  const order = [1, 2, 3, 4, 5, 6, 0];
  if (loading) return <Loading />;
  const days = order.filter((d) => data?.some((e) => e.dayOfWeek === d));
  return (
    <>
      <PageHead title="Timetable" description="Your weekly lessons." />
      {days.length ? (
        <div className="week">
          {days.map((d) => (
            <div key={d} className={`day ${d === today ? "today" : ""}`}>
              <h3>{WEEKDAYS[d]}{d === today ? " · today" : ""}</h3>
              {data!.filter((e) => e.dayOfWeek === d).map((e) => (
                <div key={e.id} className="lesson">
                  <strong>{e.startTime}–{e.endTime}</strong>
                  {e.class.name}
                  <div className="muted small">{e.room ?? e.class.room ?? ""}{e.class.teacher ? ` · ${e.class.teacher.name}` : ""}</div>
                  {e.class.meetingUrl && <a href={e.class.meetingUrl} target="_blank" rel="noopener noreferrer" className="small">Join online</a>}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : <div className="card"><Empty icon="calendar" title="No lessons scheduled" /></div>}
    </>
  );
}

interface Assignment { id: string; title: string; description: string | null; attachmentUrl: string | null; skill: string | null; dueAt: string | null; totalPoints: number; class: { name: string }; submission: { id: string; content: string | null; fileUrl: string | null; grade: number | null; feedback: string | null; submittedAt: string } | null }

export function Assignments() {
  const student = useStudent();
  const { data, loading, reload } = useData<Assignment[]>("/me/assignments", ["assignments", `student:${student.id}`]);
  const [open, setOpen] = useState<Assignment | null>(null);
  const [filter, setFilter] = useState<"todo" | "done">("todo");
  usePageMeta("Assignments");
  if (loading) return <Loading />;
  const todo = (data ?? []).filter((a) => !a.submission);
  const done = (data ?? []).filter((a) => a.submission);
  const shown = filter === "todo" ? todo : done;
  return (
    <>
      <PageHead title="Assignments" />
      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={filter === "todo"} onClick={() => setFilter("todo")}>To do ({todo.length})</button>
        <button className="tab" role="tab" aria-selected={filter === "done"} onClick={() => setFilter("done")}>Handed in ({done.length})</button>
      </div>
      {shown.length ? (
        <div className="stack">
          {shown.map((a) => {
            const late = a.dueAt && !a.submission && new Date(a.dueAt) < new Date();
            return (
              <article key={a.id} className="card">
                <div className="row-between">
                  <div>
                    <h3 style={{ margin: 0 }}>{a.title}</h3>
                    <p className="muted small" style={{ margin: ".2rem 0" }}>{a.class.name}{a.skill ? ` · ${a.skill}` : ""}{a.dueAt ? ` · due ${dateTime(a.dueAt)}` : ""} · {a.totalPoints} points</p>
                  </div>
                  <div className="row">
                    {late && <span className="badge badge-danger">Late</span>}
                    {a.submission?.grade !== null && a.submission?.grade !== undefined ? <span className="badge badge-success">{a.submission.grade}/{a.totalPoints}</span> : a.submission ? <span className="badge badge-info">Waiting for marking</span> : null}
                    <Button size="sm" variant={a.submission ? "outline" : ""} onClick={() => setOpen(a)}>{a.submission ? "View" : "Hand in"}</Button>
                  </div>
                </div>
                {a.submission?.feedback && <p className="small" style={{ margin: ".5rem 0 0" }}><strong>Teacher's feedback:</strong> {a.submission.feedback}</p>}
              </article>
            );
          })}
        </div>
      ) : <div className="card"><Empty icon="check-circle" title={filter === "todo" ? "Nothing to hand in" : "Nothing handed in yet"} /></div>}
      {open && <Submit assignment={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); void reload(); }} />}
    </>
  );
}

function Submit({ assignment, onClose, onDone }: { assignment: Assignment; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [content, setContent] = useState(assignment.submission?.content ?? "");
  const [file, setFile] = useState<string | null>(assignment.submission?.fileUrl ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const graded = assignment.submission?.grade !== null && assignment.submission?.grade !== undefined;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/me/assignments/${assignment.id}/submit`, { content: content || undefined, fileUrl: file || undefined });
      toast("Handed in. Your teacher has been told.");
      onDone();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={assignment.title} onClose={onClose} wide>
      <RichText className="prose" text={assignment.description} />
      {assignment.attachmentUrl && <p><a href={mediaUrl(assignment.attachmentUrl)} target="_blank" rel="noopener noreferrer"><Icon name="paperclip" /> Attachment from your teacher</a></p>}
      <hr />
      {graded ? (
        <p><strong>Mark:</strong> {assignment.submission!.grade}/{assignment.totalPoints}{assignment.submission!.feedback ? ` — ${assignment.submission!.feedback}` : ""}</p>
      ) : (
        <form onSubmit={submit}>
          <ErrorNote error={error} />
          <TextArea label="Your answer" value={content} onChange={(e) => setContent(e.target.value)} rows={8} />
          <FileField label="Or attach a file (photo of your work, Word or PDF)" value={file} onChange={setFile} realm="student" />
          <div className="form-actions"><Button type="submit" loading={busy} disabled={!content.trim() && !file}>{assignment.submission ? "Hand in again" : "Hand in"}</Button></div>
        </form>
      )}
    </Modal>
  );
}
