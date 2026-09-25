import { Loading, PageHead } from "@/components/ui";
import { BarChart, HBars, shortMonth } from "@/components/Charts";
import { useSite } from "@/context/SiteContext";
import { useData, usePageMeta } from "@/hooks/useData";
import { humanize, money } from "@/lib/format";

interface Report {
  newStudents: Array<{ month: string; count: number }>;
  applications: Array<{ month: string; count: number }>;
  revenue: Array<{ month: string; amount: number }>;
  applicationStatus: Array<{ label: string; count: number }>;
  conversionRate: number | null;
  enquiryChannels: Array<{ label: string; count: number }>;
  placementLevels: Array<{ label: string; count: number }>;
  studentLevels: Array<{ label: string; count: number }>;
  courses: Array<{ label: string; count: number }>;
  attendanceRate: number | null;
  examResults: Array<{ label: string; average: number; passRate: number; attempts: number }>;
}

/** Trends over the last twelve months. Spreadsheets of any list are under each list's Export button. */
export default function Reports() {
  const { content } = useSite();
  const { data, loading } = useData<Report>("/reports/overview");
  usePageMeta("Reports");
  if (loading || !data) return <Loading />;
  const currency = content?.institution.currency;
  const counts = (rows: Array<{ label: string; count: number }>) => rows.map((r) => ({ label: humanize(r.label), value: r.count }));
  return (
    <>
      <PageHead title="Reports" description="The last twelve months. Use Export on any list for a spreadsheet." actions={<button className="btn btn-outline" onClick={() => window.print()}>Print</button>} />
      <div className="kpis">
        <div className="kpi"><span className="stat-label">Applications accepted</span><span className="stat-value">{data.conversionRate ?? "—"}{data.conversionRate !== null && "%"}</span></div>
        <div className="kpi"><span className="stat-label">Attendance</span><span className="stat-value">{data.attendanceRate ?? "—"}{data.attendanceRate !== null && "%"}</span></div>
        <div className="kpi"><span className="stat-label">New students (12 months)</span><span className="stat-value">{data.newStudents.reduce((s, m) => s + m.count, 0)}</span></div>
        <div className="kpi"><span className="stat-label">Money received (12 months)</span><span className="stat-value" style={{ fontSize: "1.3rem" }}>{money(data.revenue.reduce((s, m) => s + m.amount, 0), currency)}</span></div>
      </div>
      <div className="grid-2">
        <section className="card"><h2>New students</h2><BarChart data={data.newStudents.map((m) => ({ label: shortMonth(m.month), value: m.count }))} /></section>
        <section className="card"><h2>Applications</h2><BarChart data={data.applications.map((m) => ({ label: shortMonth(m.month), value: m.count }))} gold /></section>
        <section className="card"><h2>Money received</h2><BarChart data={data.revenue.map((m) => ({ label: shortMonth(m.month), value: m.amount }))} format={(v) => money(v, currency)} /></section>
        <section className="card"><h2>Students by level</h2><HBars data={counts(data.studentLevels)} /></section>
        <section className="card"><h2>Students by course</h2><HBars data={counts(data.courses)} /></section>
        <section className="card"><h2>Where enquiries come from</h2><HBars data={counts(data.enquiryChannels)} /></section>
        <section className="card"><h2>Placement test results</h2><HBars data={counts(data.placementLevels)} /></section>
        <section className="card"><h2>Applications by status</h2><HBars data={counts(data.applicationStatus)} /></section>
        <section className="card">
          <h2>Exam results by class</h2>
          {data.examResults.length ? <HBars data={data.examResults.map((r) => ({ label: `${r.label} (${r.passRate}% passed)`, value: r.average }))} format={(v) => `${v}%`} /> : <p className="muted small">No marked exams yet.</p>}
        </section>
      </div>
    </>
  );
}
