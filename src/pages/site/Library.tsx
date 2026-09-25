import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHero } from "./PageHero";
import { Empty, Loading } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useData, usePageMeta } from "@/hooks/useData";
import { mediaUrl } from "@/services/api";

export interface LibraryItem { id: string; title: string; author: string | null; language: string | null; level: string | null; type: string | null; fileUrl: string | null; coverUrl: string | null; description: string | null; free: boolean }

export function LibraryGrid({ items }: { items: LibraryItem[] }) {
  const [q, setQ] = useState("");
  const [level, setLevel] = useState("All");
  const levels = useMemo(() => ["All", ...new Set(items.map((i) => i.level).filter(Boolean) as string[])].sort(), [items]);
  const shown = items.filter((i) => (level === "All" || i.level === level) && (!q || `${i.title} ${i.author ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <div className="row" style={{ marginBottom: "1rem" }}>
        <input className="input" style={{ maxWidth: 320 }} placeholder="Search title or author" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the library" />
        <div className="filters" style={{ margin: 0 }}>{levels.map((l) => <button key={l} className={`chip ${l === level ? "active" : ""}`} onClick={() => setLevel(l)}>{l}</button>)}</div>
      </div>
      {shown.length ? (
        <div className="grid">
          {shown.map((item) => (
            <div key={item.id} className="course-card">
              {item.coverUrl && <img src={mediaUrl(item.coverUrl)} alt="" loading="lazy" />}
              <div className="course-card-body">
                <span className="course-lang">{[item.language, item.level, item.type].filter(Boolean).join(" · ")}</span>
                <h3>{item.title}</h3>
                {item.author && <p className="muted small" style={{ margin: 0 }}>{item.author}</p>}
                {item.description && <p className="small muted" style={{ margin: 0 }}>{item.description}</p>}
                <div className="course-fee">
                  {item.fileUrl ? (
                    <a className="btn btn-sm" href={mediaUrl(item.fileUrl)} target="_blank" rel="noopener noreferrer"><Icon name="download" /> Open</a>
                  ) : (
                    <Link className="btn btn-outline btn-sm" to="/sign-in"><Icon name="lock" /> Students only</Link>
                  )}
                  {item.free && <span className="badge badge-success">Free</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : <Empty icon="book-open" title="Nothing matches" />}
    </>
  );
}

export default function Library() {
  const { data, loading } = useData<LibraryItem[]>("/public/r/library", ["library"]);
  usePageMeta("Library", "Free German learning books, audio and worksheets.");
  return (
    <div className="page-enter">
      <PageHero title="Library" intro="Books, audio and worksheets to practise at home. Students see the full collection in their portal." />
      <section className="section"><div className="container">{loading ? <Loading /> : <LibraryGrid items={data ?? []} />}</div></section>
    </div>
  );
}
