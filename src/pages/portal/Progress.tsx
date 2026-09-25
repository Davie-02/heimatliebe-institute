import { Empty, Loading, PageHead, Status } from "@/components/ui";
import { HBars } from "@/components/Charts";
import { Icon } from "@/components/Icon";
import { useStudent } from "@/context/AuthContext";
import { useData, usePageMeta } from "@/hooks/useData";
import { date } from "@/lib/format";

interface Results {
  exams: Array<{ id: string; percentage: number | null; passed: boolean | null; needsReview: boolean; feedback: string | null; submittedAt: string; exam: { title: string; class: { name: string } | null } }>;
  assignments: Array<{ id: string; grade: number; feedback: string | null; gradedAt: string; assignment: { title: string; totalPoints: number; skill: string | null; class: { name: string } } }>;
  skills: Array<{ id: string; term: string | null; reading: number | null; writing: number | null; listening: number | null; speaking: number | null; cefrLevel: string | null; comments: string | null; createdAt: string; assessedBy: { name: string } | null }>;
  certificates: Certificate[];
}
interface Certificate { id: string; certificateNo: string; verificationCode: string; course: string; level: string | null; grade: string | null; hours: number | null; issuedAt: string }

export default function Results() {
  const student = useStudent();
  const { data, loading } = useData<Results>("/me/results", ["exams", "assignments", "skill-assessments", `student:${student.id}`]);
  usePageMeta("Results");
  if (loading || !data) return <Loading />;
  const latest = data.skills[0];
  return (
    <>
      <PageHead title="Results & progress" />
      {latest && (
        <section className="card" style={{ marginBottom: "1rem" }}>
          <div className="card-head"><h2>Latest skills report</h2>{latest.cefrLevel && <span className="badge badge-brand">Level {latest.cefrLevel}</span>}</div>
          <HBars data={(["reading", "writing", "listening", "speaking"] as const).filter((k) => latest[k] !== null).map((k) => ({ label: k[0].toUpperCase() + k.slice(1), value: latest[k] ?? 0 }))} format={(v) => `${v}%`} />
          {latest.comments && <p className="small" style={{ marginTop: "1rem" }}>{latest.comments}</p>}
          <p className="muted small">{latest.term ?? ""} · {date(latest.createdAt)}{latest.assessedBy ? ` · ${latest.assessedBy.name}` : ""}</p>
        </section>
      )}
      <div className="grid-2">
        <section className="card">
          <h2>Exams</h2>
          {data.exams.length ? (
            <ul className="list">{data.exams.map((e) => <li key={e.id}><div><strong>{e.exam.title}</strong><div className="muted small">{e.exam.class?.name} · {date(e.submittedAt)}</div>{e.feedback && <div className="small">{e.feedback}</div>}</div>{e.needsReview ? <span className="badge badge-info">Being marked</span> : <span className={`badge ${e.passed ? "badge-success" : "badge-danger"}`}>{e.percentage}%</span>}</li>)}</ul>
          ) : <Empty icon="check-square" title="No exam results yet" />}
        </section>
        <section className="card">
          <h2>Assignments</h2>
          {data.assignments.length ? (
            <ul className="list">{data.assignments.map((a) => <li key={a.id}><div><strong>{a.assignment.title}</strong><div className="muted small">{a.assignment.class.name}{a.assignment.skill ? ` · ${a.assignment.skill}` : ""}</div>{a.feedback && <div className="small">{a.feedback}</div>}</div><span className="badge badge-brand">{a.grade}/{a.assignment.totalPoints}</span></li>)}</ul>
          ) : <Empty icon="edit" title="No marked assignments yet" />}
        </section>
      </div>
    </>
  );
}

interface AttendanceData { records: Array<{ id: string; date: string; status: string; notes: string | null; class: { name: string } }>; counts: Record<string, number>; rate: number | null }

export function Attendance() {
  const student = useStudent();
  const { data, loading } = useData<AttendanceData>("/me/attendance", ["attendance", `student:${student.id}`]);
  usePageMeta("Attendance");
  if (loading || !data) return <Loading />;
  return (
    <>
      <PageHead title="Attendance" description={data.rate !== null ? `You attended ${data.rate}% of lessons.` : undefined} />
      <div className="kpis">
        {(["present", "late", "absent", "excused"] as const).map((k) => (
          <div className="kpi" key={k}><span className="stat-label">{k[0].toUpperCase() + k.slice(1)}</span><span className="stat-value">{data.counts[k] ?? 0}</span></div>
        ))}
      </div>
      {data.records.length ? (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>Date</th><th>Class</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>{data.records.map((r) => <tr key={r.id}><td data-label="Date">{date(r.date)}</td><td data-label="Class">{r.class.name}</td><td data-label="Status"><Status value={r.status} /></td><td data-label="Note">{r.notes ?? ""}</td></tr>)}</tbody>
          </table>
        </div>
      ) : <div className="card"><Empty icon="user-check" title="No registers yet" /></div>}
    </>
  );
}

export function Certificates() {
  const { data, loading } = useData<Certificate[]>("/me/certificates", ["certificates"]);
  usePageMeta("Certificates");
  if (loading) return <Loading />;
  return (
    <>
      <PageHead title="Certificates" description="Anyone can check your certificates are genuine on our website with the verification code." />
      {data?.length ? (
        <div className="grid">
          {data.map((c) => (
            <article key={c.id} className="card stack">
              <span className="tile-icon"><Icon name="award" /></span>
              <h3 style={{ margin: 0 }}>{c.course}{c.level ? ` (${c.level})` : ""}</h3>
              <p className="muted small" style={{ margin: 0 }}>Issued {date(c.issuedAt)}{c.grade ? ` · ${c.grade}` : ""}{c.hours ? ` · ${c.hours} hours` : ""}</p>
              <p className="small" style={{ margin: 0 }}>Certificate <span className="mono">{c.certificateNo}</span><br />Verification code <span className="mono">{c.verificationCode}</span></p>
              <a className="btn btn-outline btn-sm" href={`/verify/${c.verificationCode}`} target="_blank" rel="noopener noreferrer">Verification page</a>
            </article>
          ))}
        </div>
      ) : <div className="card"><Empty icon="award" title="No certificates yet">They appear here when you complete a course.</Empty></div>}
    </>
  );
}
