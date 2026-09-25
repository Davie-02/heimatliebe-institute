import { Link } from "react-router-dom";
import { usePageMeta } from "@/hooks/useData";

export default function NotFound() {
  usePageMeta("Page not found");
  return (
    <section className="section">
      <div className="narrow" style={{ textAlign: "center" }}>
        <p className="result-level">404</p>
        <h1>This page doesn't exist</h1>
        <p className="muted">It may have moved. Try the homepage or the courses.</p>
        <div className="row" style={{ justifyContent: "center" }}>
          <Link to="/" className="btn">Homepage</Link>
          <Link to="/courses" className="btn btn-outline">Courses</Link>
        </div>
      </div>
    </section>
  );
}
