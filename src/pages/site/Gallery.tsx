import { useMemo, useState } from "react";
import { PageHero } from "./PageHero";
import { Empty, Loading } from "@/components/ui";
import { useData, usePageMeta } from "@/hooks/useData";
import { mediaUrl } from "@/services/api";

interface Photo { id: string; src: string; caption: string | null; category: string | null }

export default function Gallery() {
  const { data, loading } = useData<Photo[]>("/public/r/gallery", ["gallery"]);
  const [category, setCategory] = useState("All");
  const [open, setOpen] = useState<Photo | null>(null);
  usePageMeta("Gallery", "Life at Heimatliebe Institute in pictures.");
  const categories = useMemo(() => ["All", ...new Set((data ?? []).map((p) => p.category).filter(Boolean) as string[])], [data]);
  const shown = (data ?? []).filter((p) => category === "All" || p.category === category);
  return (
    <div className="page-enter">
      <PageHero title="Gallery" intro="Classes, events and celebrations at the institute." />
      <section className="section">
        <div className="container">
          {categories.length > 2 && (
            <div className="filters">{categories.map((c) => <button key={c} className={`chip ${c === category ? "active" : ""}`} onClick={() => setCategory(c)}>{c}</button>)}</div>
          )}
          {loading ? <Loading /> : shown.length ? (
            <div className="gallery">
              {shown.map((p) => (
                <button key={p.id} className="photo" onClick={() => setOpen(p)} aria-label={p.caption ?? "Open photo"}>
                  <img src={mediaUrl(p.src)} alt={p.caption ?? ""} loading="lazy" />
                </button>
              ))}
            </div>
          ) : <Empty icon="image" title="No photos yet" />}
        </div>
      </section>
      {open && (
        <figure className="lightbox" onClick={() => setOpen(null)} role="dialog" aria-label={open.caption ?? "Photo"}>
          <img src={mediaUrl(open.src)} alt={open.caption ?? ""} />
          {open.caption && <figcaption>{open.caption}</figcaption>}
        </figure>
      )}
    </div>
  );
}
