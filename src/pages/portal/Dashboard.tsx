import { Link } from "react-router-dom";
import { Alert, Empty, ErrorNote, Loading, PageHead } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { RichText } from "@/components/RichText";
import { useStudent } from "@/context/AuthContext";
import { useData, usePageMeta } from "@/hooks/useData";
import { date, dateTime, money } from "@/lib/format";

interface Dashboard {
  today: Array<{ id: string; startTime: string; endTime: string; room: string | null; class: { name: string; room: string | null; meetingUrl: string | null; mode: string } }>;
  dueSoon: Array<{ id: string; title: string; dueAt: string; class: { name: string } }>;
  openExams: Array<{ id: string; title: string; closesAt: string | null; durationMinutes: number }>;
  balance: number;
  overdue: number;
  currency: string;
  attendanceRate: number | null;
  attendanceAlert: number;
  announcements: Array<{ id: string; title: string; body: string | null; createdAt: string }>;
}

export default function StudentDashboard() {
  const student = useStudent();
  const { data, loading, error } = useData<Dashboard>("/me/dashboard", ["assignments", "exams", `fees:${student.id}`, `student:${student.id}`, "announcements"]);
  usePageMeta("My portal");
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  if (loading) return <Loading />;
  return (
    <>
      <PageHead title={`${greeting}, ${student.name.split(" ")[0]}`} description={`${student.studentNo}${student.level ? ` · Level ${student.level}` : ""}${student.course ? ` · ${student.course}` : ""}`} />
      <ErrorNote error={error} />
      {data && (
        <>
          {data.attendanceRate !== null && data.attendanceRate < data.attendanceAlert && (
            <Alert tone="warning">Your attendance is {data.attendanceRate}%. Please try to attend every lesson — talk to your teacher if something is making it difficult.</Alert>
          )}
          <div className="kpis">
            <Link to="/portal/fees" className={`kpi ${data.balance > 0 ? "alert-kpi" : ""}`}>
              <span className="icon-wrap"><Icon name="wallet" /></span>
              <span className="stat-label">Fees balance</span>
              <span className="stat-value">{money(data.balance, data.currency)}</span>
              {data.overdue > 0 && <span className="badge badge-danger">{data.overdue} overdue</span>}
            </Link>
            <Link to="/portal/attendance" className="kpi">
              <span className="icon-wrap"><Icon name="user-check" /></span>
              <span className="stat-label">Attendance</span>
              <span className="stat-value">{data.attendanceRate ?? "—"}{data.attendanceRate !== null && "%"}</span>
            </Link>
            <Link to="/portal/assignments" className="kpi">
              <span className="icon-wrap"><Icon name="edit" /></span>
              <span className="stat-label">Assignments due</span>
              <span className="stat-value">{data.dueSoon.length}</span>
            </Link>
            <Link to="/portal/exams" className="kpi">
              <span className="icon-wrap"><Icon name="check-square" /></span>
              <span className="stat-label">Open exams</span>
              <span className="stat-value">{data.openExams.length}</span>
            </Link>
          </div>
          <div className="grid-2">
            <section className="card">
              <div className="card-head"><h2>Today's lessons</h2><Link to="/portal/timetable" className="small">Full timetable</Link></div>
              {data.today.length ? (
                <ul className="list">
                  {data.today.map((l) => (
                    <li key={l.id}>
                      <div><strong>{l.startTime}–{l.endTime}</strong> · {l.class.name}<div className="muted small">{l.room ?? l.class.room ?? (l.class.mode === "online" ? "Online" : "")}</div></div>
                      {l.class.meetingUrl && <a className="btn btn-sm" href={l.class.meetingUrl} target="_blank" rel="noopener noreferrer"><Icon name="video" /> Join</a>}
                    </li>
                  ))}
                </ul>
              ) : <Empty icon="sun" title="No lessons today" />}
            </section>
            <section className="card">
              <div className="card-head"><h2>Coming up</h2></div>
              {data.dueSoon.length || data.openExams.length ? (
                <ul className="list">
                  {data.openExams.map((e) => (
                    <li key={e.id}><div><strong>{e.title}</strong><div className="muted small">Exam · {e.durationMinutes} min{e.closesAt ? ` · closes ${dateTime(e.closesAt)}` : ""}</div></div><Link className="btn btn-sm btn-gold" to={`/portal/exams/${e.id}`}>Start</Link></li>
                  ))}
                  {data.dueSoon.map((a) => (
                    <li key={a.id}><div><strong>{a.title}</strong><div className="muted small">{a.class.name} · due {dateTime(a.dueAt)}</div></div><Link className="btn btn-sm btn-outline" to="/portal/assignments">Open</Link></li>
                  ))}
                </ul>
              ) : <Empty icon="check-circle" title="You're all caught up" />}
            </section>
          </div>
          {data.announcements.length > 0 && (
            <section className="card" style={{ marginTop: "1rem" }}>
              <div className="card-head"><h2>Announcements</h2><Link to="/portal/announcements" className="small">All</Link></div>
              {data.announcements.map((a) => (
                <article key={a.id} style={{ marginBottom: "1rem" }}><strong>{a.title}</strong> <span className="muted small">· {date(a.createdAt)}</span><RichText className="muted small" text={a.body} /></article>
              ))}
            </section>
          )}
        </>
      )}
    </>
  );
}
