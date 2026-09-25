import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Avatar, Button, Check, Empty, ErrorNote, Loading, Modal, PageHead, SelectField, Tabs, TextArea, TextField } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { FileField } from "@/components/FileField";
import { RichText } from "@/components/RichText";
import { useToast } from "@/components/Toasts";
import { useStaff } from "@/context/AuthContext";
import { useData, usePageMeta } from "@/hooks/useData";
import { can } from "@/admin/access";
import { api, mediaUrl } from "@/services/api";
import { dateTime, toDateTimeInput, WEEKDAYS } from "@/lib/format";

interface ClassSummary { id: string; name: string; level: string | null; room: string | null; mode: string; meetingUrl: string | null; students: number; toMark: number; course: { title: string } | null; teacher: { name: string } | null; timetable: Array<{ id: string; dayOfWeek: number; startTime: string; endTime: string }> }

/** A teacher's classes. Academic coordinators can switch to see every class. */
export default function MyClasses() {
  const user = useStaff();
  const [all, setAll] = useState(false);
  const { data, loading } = useData<ClassSummary[]>(`/teaching/classes${all ? "?all=true" : ""}`, ["classes", "assignments", "exams"]);
  usePageMeta("My classes");
  return (
    <>
      <PageHead title={all ? "All classes" : "My classes"} actions={can(user, "academics") ? <Check label="Show every class" checked={all} onChange={(e) => setAll(e.target.checked)} /> : undefined} />
      {loading ? <Loading /> : data?.length ? (
        <div className="grid">
          {data.map((c) => (
            <Link key={c.id} to={`/admin/teaching/${c.id}`} className="tile" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="row-between"><span className="tile-icon"><Icon name="school" /></span>{c.toMark > 0 && <span className="badge badge-warning">{c.toMark} to mark</span>}</div>
              <h3>{c.name}</h3>
              <p>{c.course?.title}{c.level ? ` · ${c.level}` : ""} · {c.students} students{all && c.teacher ? ` · ${c.teacher.name}` : ""}</p>
              <p className="small">{c.timetable.map((t) => `${WEEKDAYS[t.dayOfWeek].slice(0, 3)} ${t.startTime}`).join(" · ")}</p>
            </Link>
          ))}
        </div>
      ) : <div className="card"><Empty icon="school" title="No classes assigned to you yet">The academic office assigns teachers to classes.</Empty></div>}
    </>
  );
}

interface Roster { class: { id: string; name: string; level: string | null; room: string | null; meetingUrl: string | null; course: { title: string } | null; teacher: { id: string; name: string } | null }; students: Array<{ id: string; name: string; studentNo: string; email: string; phone: string | null; photoUrl: string | null; level: string | null; enrollment: string; attendanceRate: number | null }> }
type Tab = "students" | "register" | "assignments" | "exams" | "gradebook" | "skills";

export function ClassPage() {
  const { classId } = useParams();
  const { data, loading, error } = useData<Roster>(`/teaching/classes/${classId}`, ["enrollments", "attendance"]);
  const [tab, setTab] = useState<Tab>("register");
  const [notify, setNotify] = useState(false);
  usePageMeta(data?.class.name ?? "Class");
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote error={error} />;
  return (
    <>
      <div className="breadcrumb" style={{ marginBottom: ".5rem" }}><Link to="/admin/teaching"><Icon name="chevron-left" /> My classes</Link></div>
      <PageHead
        title={data.class.name}
        description={`${data.class.course?.title ?? ""}${data.class.level ? ` · ${data.class.level}` : ""}${data.class.room ? ` · ${data.class.room}` : ""} · ${data.students.length} students`}
        actions={<>{data.class.meetingUrl && <a className="btn btn-outline" href={data.class.meetingUrl} target="_blank" rel="noopener noreferrer"><Icon name="video" /> Online classroom</a>}<Button variant="outline" icon="megaphone" onClick={() => setNotify(true)}>Message the class</Button></>}
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "register", label: "Register" },
          { value: "students", label: "Students" },
          { value: "assignments", label: "Assignments" },
          { value: "exams", label: "Exams" },
          { value: "gradebook", label: "Gradebook" },
          { value: "skills", label: "Skills report" },
        ]}
      />
      {tab === "students" && <StudentsTab roster={data} />}
      {tab === "register" && <Register roster={data} />}
      {tab === "assignments" && <AssignmentsTab classId={data.class.id} />}
      {tab === "exams" && <ExamsTab classId={data.class.id} />}
      {tab === "gradebook" && <Gradebook classId={data.class.id} />}
      {tab === "skills" && <SkillsForm roster={data} />}
      {notify && <NotifyClass classId={data.class.id} onClose={() => setNotify(false)} />}
    </>
  );
}

function StudentsTab({ roster }: { roster: Roster }) {
  if (!roster.students.length) return <div className="card"><Empty icon="users" title="No students in this class yet" /></div>;
  return (
    <div className="table-wrap">
      <table className="table responsive">
        <thead><tr><th>Student</th><th>Number</th><th>Phone</th><th className="num">Attendance</th></tr></thead>
        <tbody>
          {roster.students.map((s) => (
            <tr key={s.id}>
              <td data-label="Student"><span className="row"><Avatar name={s.name} src={s.photoUrl} size={30} /> {s.name}</span></td>
              <td data-label="Number" className="mono">{s.studentNo}</td>
              <td data-label="Phone">{s.phone ? <a href={`tel:${s.phone}`}>{s.phone}</a> : "—"}</td>
              <td data-label="Attendance" className="num">{s.attendanceRate === null ? "—" : <span className={`badge ${s.attendanceRate < 75 ? "badge-danger" : "badge-success"}`}>{s.attendanceRate}%</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUSES = ["present", "late", "absent", "excused"] as const;

/** The register: everyone starts present, tap to change, save. Works well on a phone in class. */
function Register({ roster }: { roster: Roster }) {
  const toast = useToast();
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const existing = useData<Array<{ studentId: string; status: string; notes: string | null }>>(`/teaching/classes/${roster.class.id}/attendance?date=${day}`);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [notifyAbsent, setNotifyAbsent] = useState(true);
  const [busy, setBusy] = useState(false);
  const students = roster.students.filter((s) => s.enrollment === "active");

  useEffect(() => {
    const saved = Object.fromEntries((existing.data ?? []).map((r) => [r.studentId, r.status]));
    setMarks(Object.fromEntries(students.map((s) => [s.id, saved[s.id] ?? "present"])));
  }, [existing.data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setBusy(true);
    try {
      const result = await api.put<{ saved: number }>(`/teaching/classes/${roster.class.id}/attendance`, { date: day, entries: Object.entries(marks).map(([studentId, status]) => ({ studentId, status })), notifyAbsent });
      toast(`Register saved for ${result.saved} students.`);
      void existing.reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (!students.length) return <div className="card"><Empty icon="users" title="No active students" /></div>;
  const counts = STATUSES.map((s) => `${Object.values(marks).filter((v) => v === s).length} ${s}`).join(" · ");
  return (
    <>
      <div className="row-between" style={{ marginBottom: "1rem" }}>
        <input type="date" className="input" style={{ width: "auto" }} value={day} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDay(e.target.value)} aria-label="Date" />
        <span className="muted small">{existing.data?.length ? "Already taken — changes will update it." : "Not taken yet."} {counts}</span>
      </div>
      {existing.loading ? <Loading /> : (
        <div className="register">
          {students.map((s) => (
            <div key={s.id} className="register-row">
              <span className="row"><Avatar name={s.name} src={s.photoUrl} size={30} /> {s.name}</span>
              <div className="segmented" role="group" aria-label={`Attendance for ${s.name}`}>
                {STATUSES.map((status) => (
                  <button key={status} type="button" data-v={status} aria-pressed={marks[s.id] === status} onClick={() => setMarks({ ...marks, [s.id]: status })}>
                    {status[0].toUpperCase() + status.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="form-actions">
        <Check label="Tell absent students" checked={notifyAbsent} onChange={(e) => setNotifyAbsent(e.target.checked)} />
        <Button icon="check" loading={busy} onClick={() => void save()}>Save register</Button>
      </div>
    </>
  );
}

interface AssignmentRow { id: string; title: string; description: string | null; attachmentUrl: string | null; skill: string | null; dueAt: string | null; totalPoints: number; published: boolean; submitted: number; toMark: number; students: number }

function AssignmentsTab({ classId }: { classId: string }) {
  const { data, loading, reload } = useData<AssignmentRow[]>(`/teaching/classes/${classId}/assignments`, [`class:${classId}`, "assignments"]);
  const [editing, setEditing] = useState<AssignmentRow | "new" | null>(null);
  const [marking, setMarking] = useState<AssignmentRow | null>(null);
  if (loading) return <Loading />;
  return (
    <>
      <div className="row-between" style={{ marginBottom: "1rem" }}><span className="muted small">{data?.length ?? 0} assignments</span><Button icon="plus" onClick={() => setEditing("new")}>New assignment</Button></div>
      {data?.length ? (
        <div className="stack">
          {data.map((a) => (
            <article key={a.id} className="card row-between">
              <div>
                <h3 style={{ margin: 0 }}>{a.title} {!a.published && <span className="badge">Hidden</span>}</h3>
                <p className="muted small" style={{ margin: ".2rem 0 0" }}>{a.skill ? `${a.skill} · ` : ""}{a.dueAt ? `due ${dateTime(a.dueAt)} · ` : ""}{a.totalPoints} points · {a.submitted}/{a.students} handed in</p>
              </div>
              <div className="row">
                {a.toMark > 0 && <span className="badge badge-warning">{a.toMark} to mark</span>}
                <Button size="sm" onClick={() => setMarking(a)}>Submissions</Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(a)}>Edit</Button>
              </div>
            </article>
          ))}
        </div>
      ) : <div className="card"><Empty icon="edit" title="No assignments yet" /></div>}
      {editing && <AssignmentForm classId={classId} assignment={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
      {marking && <Submissions assignment={marking} onClose={() => { setMarking(null); void reload(); }} />}
    </>
  );
}

function AssignmentForm({ classId, assignment, onClose, onSaved }: { classId: string; assignment?: AssignmentRow; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ title: assignment?.title ?? "", description: assignment?.description ?? "", skill: assignment?.skill ?? "", dueAt: toDateTimeInput(assignment?.dueAt), totalPoints: String(assignment?.totalPoints ?? 100), published: assignment?.published ?? true });
  const [file, setFile] = useState<string | null>(assignment?.attachmentUrl ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { ...form, totalPoints: Number(form.totalPoints), dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : undefined, attachmentUrl: file ?? undefined, skill: form.skill || undefined };
      if (assignment) await api.patch(`/teaching/assignments/${assignment.id}`, body);
      else await api.post(`/teaching/classes/${classId}/assignments`, body);
      toast(assignment ? "Saved." : "Assignment set. Students have been told.");
      onSaved();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!assignment) return;
    setBusy(true);
    try {
      await api.del(`/teaching/assignments/${assignment.id}`);
      toast("Deleted.");
      onSaved();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={assignment ? "Edit assignment" : "New assignment"} onClose={onClose} wide>
      <form onSubmit={submit}>
        <ErrorNote error={error} />
        <div className="form-grid">
          <TextField label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="span-all" />
          <TextArea label="Instructions" className="span-all" rows={6} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <SelectField label="Skill" value={form.skill} onChange={(e) => setForm({ ...form, skill: e.target.value })} options={["reading", "writing", "listening", "speaking", "grammar", "vocabulary"]} placeholder="—" />
          <TextField label="Due" type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
          <TextField label="Points" type="number" min="1" value={form.totalPoints} onChange={(e) => setForm({ ...form, totalPoints: e.target.value })} />
        </div>
        <FileField label="Attachment (worksheet, audio…)" value={file} onChange={setFile} />
        <Check label="Visible to students" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} />
        <div className="form-actions">
          {assignment && <Button type="button" variant="ghost" icon="trash" onClick={() => void remove()}>Delete</Button>}
          <Button type="submit" loading={busy}>{assignment ? "Save" : "Set assignment"}</Button>
        </div>
      </form>
    </Modal>
  );
}

interface SubmissionList { assignment: { title: string; totalPoints: number }; submissions: Array<{ id: string; content: string | null; fileUrl: string | null; grade: number | null; feedback: string | null; submittedAt: string; student: { name: string; studentNo: string } }>; missing: Array<{ id: string; name: string }> }

function Submissions({ assignment, onClose }: { assignment: AssignmentRow; onClose: () => void }) {
  const { data, loading, reload } = useData<SubmissionList>(`/teaching/assignments/${assignment.id}/submissions`);
  const toast = useToast();
  const [grades, setGrades] = useState<Record<string, { grade: string; feedback: string }>>({});
  async function save(id: string) {
    const g = grades[id];
    try {
      await api.post(`/teaching/submissions/${id}/grade`, { grade: Number(g.grade), feedback: g.feedback || undefined });
      toast("Mark saved. The student has been told.");
      void reload();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }
  return (
    <Modal title={`Submissions: ${assignment.title}`} onClose={onClose} wide>
      {loading || !data ? <Loading /> : (
        <div className="stack">
          {data.submissions.map((s) => {
            const g = grades[s.id] ?? { grade: s.grade?.toString() ?? "", feedback: s.feedback ?? "" };
            const late = assignment.dueAt && s.submittedAt > assignment.dueAt;
            return (
              <div key={s.id} className="card">
                <div className="row-between"><strong>{s.student.name}</strong><span className="muted small">{dateTime(s.submittedAt)} {late && <span className="badge badge-danger">late</span>}</span></div>
                {s.content && <RichText className="small" text={s.content} />}
                {s.fileUrl && <a href={mediaUrl(s.fileUrl)} target="_blank" rel="noopener noreferrer" className="small"><Icon name="paperclip" /> Attached file</a>}
                <div className="row" style={{ marginTop: ".6rem", alignItems: "flex-end" }}>
                  <TextField label={`Mark (out of ${data.assignment.totalPoints})`} type="number" min="0" max={data.assignment.totalPoints} value={g.grade} onChange={(e) => setGrades({ ...grades, [s.id]: { ...g, grade: e.target.value } })} />
                  <TextField label="Feedback" value={g.feedback} onChange={(e) => setGrades({ ...grades, [s.id]: { ...g, feedback: e.target.value } })} className="" />
                  <Button size="sm" style={{ marginBottom: "1rem" }} disabled={g.grade === ""} onClick={() => void save(s.id)}>{s.grade !== null ? "Update" : "Save mark"}</Button>
                </div>
              </div>
            );
          })}
          {!data.submissions.length && <Empty title="Nothing handed in yet" />}
          {data.missing.length > 0 && <p className="small muted">Not handed in: {data.missing.map((m) => m.name).join(", ")}</p>}
        </div>
      )}
    </Modal>
  );
}

interface ExamRow { id: string; title: string; opensAt: string | null; closesAt: string | null; durationMinutes: number; published: boolean; questionCount: number; attempts: number; toMark: number }

function ExamsTab({ classId }: { classId: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading } = useData<ExamRow[]>(`/teaching/classes/${classId}/exams`, [`class:${classId}`, "exams"]);
  async function create() {
    try {
      const exam = await api.post<{ id: string }>(`/teaching/classes/${classId}/exams`, { title: "New exam", durationMinutes: 30, questions: [] });
      navigate(`/admin/teaching/exams/${exam.id}`);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }
  if (loading) return <Loading />;
  return (
    <>
      <div className="row-between" style={{ marginBottom: "1rem" }}><span className="muted small">{data?.length ?? 0} exams</span><Button icon="plus" onClick={() => void create()}>New exam</Button></div>
      {data?.length ? (
        <div className="stack">
          {data.map((e) => (
            <article key={e.id} className="card row-between">
              <div>
                <h3 style={{ margin: 0 }}>{e.title} {e.published ? <span className="badge badge-success">Open</span> : <span className="badge">Draft</span>}</h3>
                <p className="muted small" style={{ margin: ".2rem 0 0" }}>{e.questionCount} questions · {e.durationMinutes} min{e.opensAt ? ` · opens ${dateTime(e.opensAt)}` : ""} · {e.attempts} attempts</p>
              </div>
              <div className="row">
                {e.toMark > 0 && <span className="badge badge-warning">{e.toMark} to mark</span>}
                <Link className="btn btn-sm" to={`/admin/teaching/exams/${e.id}/marking`}>Results</Link>
                <Link className="btn btn-sm btn-outline" to={`/admin/teaching/exams/${e.id}`}>Edit</Link>
              </div>
            </article>
          ))}
        </div>
      ) : <div className="card"><Empty icon="check-square" title="No exams yet" /></div>}
    </>
  );
}

interface GradebookData { columns: Array<{ id: string; kind: "assignment" | "exam"; title: string; outOf: number }>; rows: Array<{ student: { id: string; name: string; studentNo: string }; scores: Record<string, number | null>; average: number | null; attendanceRate: number | null }> }

function Gradebook({ classId }: { classId: string }) {
  const { data, loading } = useData<GradebookData>(`/teaching/classes/${classId}/gradebook`, [`class:${classId}`, "assignments", "exams", "attendance"]);
  if (loading || !data) return <Loading />;
  if (!data.rows.length) return <div className="card"><Empty title="No students yet" /></div>;
  return (
    <>
      <div className="row no-print" style={{ marginBottom: "1rem" }}><Button variant="outline" icon="printer" onClick={() => window.print()}>Print</Button></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Student</th>{data.columns.map((c) => <th key={c.id} className="num" title={c.title}>{c.title.length > 16 ? `${c.title.slice(0, 15)}…` : c.title}<br /><span className="faint">/{c.outOf}{c.kind === "exam" ? "%" : ""}</span></th>)}<th className="num">Average</th><th className="num">Attendance</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.student.id}>
                <td>{r.student.name}</td>
                {data.columns.map((c) => <td key={c.id} className="num">{r.scores[c.id] ?? <span className="faint">—</span>}</td>)}
                <td className="num"><strong>{r.average === null ? "—" : `${r.average}%`}</strong></td>
                <td className="num">{r.attendanceRate === null ? "—" : `${r.attendanceRate}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SkillsForm({ roster }: { roster: Roster }) {
  const toast = useToast();
  const [form, setForm] = useState({ studentId: "", term: "", reading: "", writing: "", listening: "", speaking: "", cefrLevel: "", comments: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const num = (v: string) => (v === "" ? undefined : Number(v));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/teaching/classes/${roster.class.id}/skills`, { studentId: form.studentId, term: form.term || undefined, reading: num(form.reading), writing: num(form.writing), listening: num(form.listening), speaking: num(form.speaking), cefrLevel: form.cefrLevel || undefined, comments: form.comments || undefined });
      toast("Skills report saved. The student can see it in their portal.");
      setForm({ ...form, studentId: "", reading: "", writing: "", listening: "", speaking: "", comments: "" });
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card" onSubmit={submit}>
      <h2>Skills report</h2>
      <p className="muted small">Scores from 0 to 100 for each skill, and the CEFR level the student has reached.</p>
      <ErrorNote error={error} />
      <div className="form-grid">
        <SelectField label="Student" required value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })} options={roster.students.map((s) => ({ value: s.id, label: s.name }))} placeholder="Choose…" />
        <TextField label="Term" value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} placeholder="e.g. Term 1 2026" />
        {(["reading", "writing", "listening", "speaking"] as const).map((k) => (
          <TextField key={k} label={k[0].toUpperCase() + k.slice(1)} type="number" min="0" max="100" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
        ))}
        <SelectField label="CEFR level reached" value={form.cefrLevel} onChange={(e) => setForm({ ...form, cefrLevel: e.target.value })} options={["A1", "A2", "B1", "B2", "C1", "C2"]} placeholder="—" />
        <TextArea label="Comments" className="span-all" value={form.comments} onChange={(e) => setForm({ ...form, comments: e.target.value })} />
      </div>
      <div className="form-actions"><Button type="submit" loading={busy} disabled={!form.studentId}>Save report</Button></div>
    </form>
  );
}

function NotifyClass({ classId, onClose }: { classId: string; onClose: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [email, setEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await api.post<{ sent: number }>(`/teaching/classes/${classId}/notify`, { title, body, email });
      toast(`Sent to ${result.sent} students.`);
      onClose();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Message the class" onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorNote error={error} />
        <TextField label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Room change tomorrow" />
        <TextArea label="Message" required value={body} onChange={(e) => setBody(e.target.value)} />
        <Check label="Also send by email" checked={email} onChange={(e) => setEmail(e.target.checked)} />
        <div className="form-actions"><Button type="submit" loading={busy} disabled={!title || !body}>Send</Button></div>
      </form>
    </Modal>
  );
}
