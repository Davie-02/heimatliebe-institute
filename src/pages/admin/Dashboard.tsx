import { Link, useParams } from "react-router-dom";
import { Empty, Loading, PageHead } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { HBars } from "@/components/Charts";
import { RichText } from "@/components/RichText";
import { useStaff } from "@/context/AuthContext";
import { useData, usePageMeta } from "@/hooks/useData";
import { MODULE_NAV } from "@/admin/nav";
import { can } from "@/admin/access";
import { date, money, relative } from "@/lib/format";
import type { ModuleKey } from "@/lib/types";

interface Overview {
  admissions?: { pending: number; newEnquiries: number; examRegistrations: number; followUps: Array<{ id: string; name: string; phone: string | null; interest: string | null; nextFollowUp: string }>; recent: Array<{ id: string; name: string; course: string; level: string; createdAt: string }> };
  students?: { active: number; newThisMonth: number; byLevel: Array<{ level: string; count: number }> };
  finance?: { pendingPayments: number; overdue: number; collectedThisMonth: number; currency: string };
  teaching?: { lessons: Array<{ id: string; startTime: string; endTime: string; class: { id: string; name: string; room: string | null; meetingUrl: string | null } }>; toMark: number };
  academics?: { activeClasses: number; upcomingSessions: number; events: Array<{ id: string; title: string; startDate: string }> };
  hr?: { pendingLeave: number; away: Array<{ name: string; until: string; type: string }> };
  assistant?: { drafts: number };
  announcements: Array<{ id: string; title: string; body: string | null; createdAt: string }>;
}

function Kpi({ to, icon, label, value, alert }: { to: string; icon: Parameters<typeof Icon>[0]["name"]; label: string; value: string | number; alert?: boolean }) {
  return (
    <Link to={to} className={`kpi ${alert ? "alert-kpi" : ""}`}>
      <span className="icon-wrap"><Icon name={icon} /></span>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </Link>
  );
}

/** Staff home: what needs attention today, only for the areas this person works in. */
export default function Dashboard() {
  const user = useStaff();
  const { data, loading } = useData<Overview>("/workspace/overview", ["applications", "enquiries", "payments", "invoices", "assignments", "exams", "leave-requests", "announcements", "students", "faq-suggestions"]);
  usePageMeta("Workspace");
  const hour = new Date().getHours();
  if (loading || !data) return <Loading />;
  return (
    <>
      <PageHead title={`${hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"}, ${user.name.split(" ")[0]}`} description={new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} />
      <div className="kpis">
        {data.admissions && <Kpi to="/admin/r/applications?status=pending" icon="file-text" label="Applications to review" value={data.admissions.pending} alert={data.admissions.pending > 0} />}
        {data.admissions && <Kpi to="/admin/r/enquiries?status=new" icon="inbox" label="New enquiries" value={data.admissions.newEnquiries} />}
        {data.finance && <Kpi to="/admin/finance/payments" icon="check-circle" label="Payments to confirm" value={data.finance.pendingPayments} alert={data.finance.pendingPayments > 0} />}
        {data.finance && <Kpi to="/admin/finance" icon="wallet" label="Collected this month" value={money(data.finance.collectedThisMonth, data.finance.currency)} />}
        {data.finance && <Kpi to="/admin/r/invoices?status=overdue" icon="alert" label="Overdue invoices" value={data.finance.overdue} alert={data.finance.overdue > 0} />}
        {data.students && <Kpi to="/admin/r/students?status=active" icon="users" label="Active students" value={data.students.active} />}
        {data.teaching && <Kpi to="/admin/teaching" icon="edit" label="Work to mark" value={data.teaching.toMark} alert={data.teaching.toMark > 0} />}
        {data.hr && <Kpi to="/admin/leave" icon="umbrella" label="Leave to decide" value={data.hr.pendingLeave} alert={data.hr.pendingLeave > 0} />}
        {data.assistant && data.assistant.drafts > 0 && <Kpi to="/admin/assistant" icon="message-circle" label="Suggested FAQ answers" value={data.assistant.drafts} />}
      </div>
      <div className="grid-2">
        {data.teaching && (
          <section className="card">
            <div className="card-head"><h2>My lessons today</h2><Link to="/admin/teaching" className="small">My classes</Link></div>
            {data.teaching.lessons.length ? (
              <ul className="list">{data.teaching.lessons.map((l) => <li key={l.id}><div><strong>{l.startTime}–{l.endTime}</strong> · {l.class.name}<div className="muted small">{l.class.room}</div></div><Link className="btn btn-sm btn-outline" to={`/admin/teaching/${l.class.id}`}>Register</Link></li>)}</ul>
            ) : <Empty icon="sun" title="No lessons today" />}
          </section>
        )}
        {data.admissions && (
          <section className="card">
            <div className="card-head"><h2>Follow up today</h2><Link to="/admin/r/enquiries" className="small">All enquiries</Link></div>
            {data.admissions.followUps.length ? (
              <ul className="list">{data.admissions.followUps.map((e) => <li key={e.id}><div><Link to={`/admin/r/enquiries/${e.id}`}><strong>{e.name}</strong></Link><div className="muted small">{e.interest ?? ""} {e.phone ? `· ${e.phone}` : ""}</div></div><span className="small muted">{date(e.nextFollowUp)}</span></li>)}</ul>
            ) : <Empty icon="check-circle" title="No follow-ups due" />}
          </section>
        )}
        {data.admissions && data.admissions.recent.length > 0 && (
          <section className="card">
            <div className="card-head"><h2>Newest applications</h2><Link to="/admin/r/applications" className="small">All</Link></div>
            <ul className="list">{data.admissions.recent.map((a) => <li key={a.id}><div><Link to={`/admin/r/applications/${a.id}`}><strong>{a.name}</strong></Link><div className="muted small">{a.course} · {a.level}</div></div><span className="small muted">{relative(a.createdAt)}</span></li>)}</ul>
          </section>
        )}
        {data.students && data.students.byLevel.length > 0 && (
          <section className="card">
            <h2>Students by level</h2>
            <HBars data={data.students.byLevel.map((l) => ({ label: l.level, value: l.count }))} />
            <p className="muted small" style={{ marginTop: "1rem" }}>{data.students.newThisMonth} new this month.</p>
          </section>
        )}
        {data.academics && data.academics.events.length > 0 && (
          <section className="card">
            <div className="card-head"><h2>Coming up</h2><Link to="/admin/r/calendar" className="small">Calendar</Link></div>
            <ul className="list">{data.academics.events.map((e) => <li key={e.id}><span>{e.title}</span><span className="muted small">{date(e.startDate)}</span></li>)}</ul>
          </section>
        )}
        {data.hr && data.hr.away.length > 0 && (
          <section className="card">
            <h2>Away today</h2>
            <ul className="list">{data.hr.away.map((a) => <li key={a.name}><span>{a.name}</span><span className="muted small">{a.type} · back after {date(a.until)}</span></li>)}</ul>
          </section>
        )}
        {data.announcements.length > 0 && (
          <section className="card">
            <h2>Staff notices</h2>
            {data.announcements.map((a) => <article key={a.id} style={{ marginBottom: ".8rem" }}><strong>{a.title}</strong> <span className="muted small">· {date(a.createdAt)}</span><RichText className="muted small" text={a.body} /></article>)}
          </section>
        )}
      </div>
    </>
  );
}

/** A module's own home: its pages as tiles. */
export function ModuleHome() {
  const { module } = useParams();
  const user = useStaff();
  const nav = MODULE_NAV.find((m) => m.key === module);
  usePageMeta(nav?.label ?? "Area");
  if (!nav || !can(user, nav.key as ModuleKey)) return <Empty title="Not available" />;
  return (
    <>
      <PageHead title={nav.label} />
      <div className="grid">
        {nav.pages.filter((p) => can(user, nav.key, p.level ?? "view")).map((p) => (
          <Link key={p.to} to={p.to} className="tile" style={{ textDecoration: "none", color: "inherit" }}>
            <span className="tile-icon"><Icon name={p.icon} /></span>
            <h3>{p.label}</h3>
            <p>{p.description}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
