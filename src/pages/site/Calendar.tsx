import { PageHero } from "./PageHero";
import { Empty, Loading, Status } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useData, usePageMeta } from "@/hooks/useData";
import { API_BASE } from "@/services/api";
import { date } from "@/lib/format";

interface Event { id: string; title: string; type: string; startDate: string; endDate: string | null; description: string | null }

export default function Calendar() {
  const { data, loading } = useData<Event[]>("/public/r/calendar", ["calendar"]);
  usePageMeta("Calendar", "Term dates, holidays, exams and events.");
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (data ?? []).filter((e) => (e.endDate ?? e.startDate).slice(0, 10) >= today);
  const feed = `${API_BASE.startsWith("http") ? API_BASE : window.location.origin + API_BASE}/public/calendar.ics`;
  return (
    <div className="page-enter">
      <PageHero title="Calendar" intro="Term dates, holidays, exam days and events." />
      <section className="section">
        <div className="container">
          <div className="alert"><Icon name="calendar" /><div>Add these dates to your phone: <a href={feed.replace(/^https?:/, "webcal:")}>subscribe to the calendar</a> or copy <code>{feed}</code> into Google Calendar.</div></div>
          {loading ? <Loading /> : upcoming.length ? (
            <ul className="timeline">
              {upcoming.map((e) => {
                const d = new Date(e.startDate);
                return (
                  <li key={e.id}>
                    <div className="date-badge"><strong>{d.getUTCDate()}</strong><span>{d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}</span></div>
                    <div>
                      <div className="row"><h3 style={{ margin: 0 }}>{e.title}</h3><Status value={e.type} /></div>
                      <p className="muted small" style={{ margin: ".2rem 0 0" }}>{date(e.startDate)}{e.endDate ? ` – ${date(e.endDate)}` : ""}</p>
                      {e.description && <p className="small" style={{ margin: ".4rem 0 0" }}>{e.description}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <Empty icon="calendar" title="Nothing scheduled yet" />}
        </div>
      </section>
    </div>
  );
}
