import { Link } from "react-router-dom";
import { Icon } from "./Icon";
import { mediaUrl } from "@/services/api";
import { money } from "@/lib/format";
import type { Course } from "@/lib/types";

export function CourseCard({ course, currency }: { course: Course; currency?: string }) {
  return (
    <Link to={`/courses/${course.slug}`} className="course-card">
      {course.image && <img src={mediaUrl(course.image)} alt="" loading="lazy" width="640" height="360" />}
      <div className="course-card-body">
        <span className="course-lang">{course.language}{course.level ? ` · ${course.level}` : ""}</span>
        <h3>{course.title}</h3>
        {course.summary && <p className="muted small" style={{ margin: 0 }}>{course.summary}</p>}
        <div className="course-meta">
          {course.schedule && <span><Icon name="clock" /> {course.schedule}</span>}
          {course.duration && <span><Icon name="calendar" /> {course.duration}</span>}
        </div>
        <div className="course-fee">
          <span>{course.feeText || (course.feeAmount ? money(course.feeAmount, currency) : "Ask about fees")}</span>
          <span className="badge badge-brand">{course.status}</span>
        </div>
      </div>
    </Link>
  );
}
