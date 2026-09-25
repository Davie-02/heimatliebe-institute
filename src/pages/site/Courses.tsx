import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHero } from "./PageHero";
import { CourseCard } from "@/components/CourseCard";
import { Reveal } from "@/components/Reveal";
import { RichText } from "@/components/RichText";
import { Icon } from "@/components/Icon";
import { Empty, ErrorNote, Loading } from "@/components/ui";
import { useSite } from "@/context/SiteContext";
import { useData, usePageMeta } from "@/hooks/useData";
import { mediaUrl } from "@/services/api";
import { money } from "@/lib/format";
import type { Course } from "@/lib/types";

export default function Courses() {
  const { content } = useSite();
  const { data, loading, error } = useData<Course[]>("/public/r/courses", ["courses"]);
  const [language, setLanguage] = useState("All");
  usePageMeta("Courses", "German and other language courses at Heimatliebe Institute, Karonga — levels A1 to B2, morning, evening and weekend classes.");
  const languages = useMemo(() => ["All", ...new Set((data ?? []).map((c) => c.language))], [data]);
  const shown = (data ?? []).filter((c) => language === "All" || c.language === language);

  return (
    <div className="page-enter">
      <PageHero title="Courses" intro="Small classes, experienced teachers and plenty of speaking practice — from your first words to exam level." />
      <section className="section">
        <div className="container">
          {languages.length > 2 && (
            <div className="filters">
              {languages.map((l) => (
                <button key={l} className={`chip ${l === language ? "active" : ""}`} onClick={() => setLanguage(l)}>{l}</button>
              ))}
            </div>
          )}
          <ErrorNote error={error} />
          {loading ? <Loading /> : shown.length ? (
            <div className="grid">
              {shown.map((course, i) => (
                <Reveal key={course.id} delay={(i % 3) * 70}><CourseCard course={course} currency={content?.institution.currency} /></Reveal>
              ))}
            </div>
          ) : <Empty icon="book" title="No courses are listed right now">Please check back soon or contact us.</Empty>}
          <Reveal className="cta-band" delay={80}>
            <div>
              <h2>Not sure which level?</h2>
              <p>The free online placement test takes about 15 minutes and recommends where to start.</p>
            </div>
            <Link to="/placement-test" className="btn btn-gold">Take the test</Link>
          </Reveal>
        </div>
      </section>
    </div>
  );
}

export function CourseDetail() {
  const { slug } = useParams();
  const { content } = useSite();
  const { data: course, loading, error } = useData<Course>(`/public/r/courses/${slug}`, ["courses"]);
  usePageMeta(course?.title ?? "Course", course?.summary ?? undefined);
  if (loading) return <Loading />;
  if (error || !course) return <div className="container section"><Empty title="Course not found"><Link to="/courses">See all courses</Link></Empty></div>;
  return (
    <div className="page-enter">
      <PageHero title={course.title} intro={course.summary} crumb={{ to: "/courses", label: "Courses" }} />
      <section className="section">
        <div className="container split">
          <div>
            {course.image && <img src={mediaUrl(course.image)} alt="" style={{ borderRadius: 16, marginBottom: "1.5rem" }} />}
            <RichText className="prose" text={course.body || course.summary} />
          </div>
          <aside className="form-card stack">
            <span className="course-lang">{course.language}{course.level ? ` · ${course.level}` : ""}</span>
            <div className="course-meta" style={{ fontSize: "1rem" }}>
              {course.schedule && <span><Icon name="clock" /> {course.schedule}</span>}
              {course.duration && <span><Icon name="calendar" /> {course.duration}</span>}
              {course.capacity ? <span><Icon name="users" /> Up to {course.capacity} students</span> : null}
              <span><Icon name="wallet" /> {course.feeText || (course.feeAmount ? money(course.feeAmount, content?.institution.currency) : "Ask about fees")}</span>
            </div>
            <span className="badge badge-brand" style={{ justifySelf: "start" }}>{course.status}</span>
            <Link to={`/apply?course=${encodeURIComponent(course.title)}&level=${course.level ?? ""}`} className="btn btn-gold btn-lg btn-block">Apply for this course</Link>
            <Link to="/placement-test" className="btn btn-outline btn-block">Check my level first</Link>
          </aside>
        </div>
      </section>
    </div>
  );
}
