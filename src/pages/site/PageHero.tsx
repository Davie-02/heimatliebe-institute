import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function PageHero({ title, intro, crumb }: { title: ReactNode; intro?: ReactNode; crumb?: { to: string; label: string } }) {
  return (
    <section className="page-hero">
      <div className="container">
        <div className="breadcrumb">
          <Link to="/">Home</Link>
          {crumb && <> / <Link to={crumb.to}>{crumb.label}</Link></>}
        </div>
        <h1>{title}</h1>
        {intro && <p>{intro}</p>}
      </div>
    </section>
  );
}
