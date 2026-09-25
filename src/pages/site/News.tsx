import { Link, useParams } from "react-router-dom";
import { PageHero } from "./PageHero";
import { Reveal } from "@/components/Reveal";
import { RichText } from "@/components/RichText";
import { Empty, Loading } from "@/components/ui";
import { useData, usePageMeta } from "@/hooks/useData";
import { mediaUrl } from "@/services/api";
import { date } from "@/lib/format";

interface Post { id: string; slug: string; title: string; category: string | null; summary: string | null; body: string | null; image: string | null; publishedAt: string }

export default function News() {
  const { data, loading } = useData<Post[]>("/public/r/news", ["news"]);
  usePageMeta("News", "News and announcements from Heimatliebe Institute.");
  return (
    <div className="page-enter">
      <PageHero title="News & announcements" />
      <section className="section">
        <div className="container">
          {loading ? <Loading /> : data?.length ? (
            <div className="grid">
              {data.map((post, i) => (
                <Reveal key={post.id} delay={(i % 3) * 70}>
                  <Link to={`/news/${post.slug}`} className="news-card">
                    {post.image && <img src={mediaUrl(post.image)} alt="" loading="lazy" width="640" height="360" />}
                    <div className="news-card-body">
                      <span className="news-cat">{post.category ?? "News"} · {date(post.publishedAt)}</span>
                      <h3 style={{ margin: ".35rem 0" }}>{post.title}</h3>
                      {post.summary && <p className="muted small" style={{ margin: 0 }}>{post.summary}</p>}
                    </div>
                  </Link>
                </Reveal>
              ))}
            </div>
          ) : <Empty icon="file-text" title="No news yet" />}
        </div>
      </section>
    </div>
  );
}

export function NewsDetail() {
  const { slug } = useParams();
  const { data: post, loading, error } = useData<Post>(`/public/r/news/${slug}`, ["news"]);
  usePageMeta(post?.title ?? "News", post?.summary ?? undefined);
  if (loading) return <Loading />;
  if (error || !post) return <div className="container section"><Empty title="Article not found"><Link to="/news">All news</Link></Empty></div>;
  return (
    <div className="page-enter">
      <PageHero title={post.title} intro={`${post.category ?? "News"} · ${date(post.publishedAt)}`} crumb={{ to: "/news", label: "News" }} />
      <section className="section">
        <article className="narrow">
          {post.image && <img src={mediaUrl(post.image)} alt="" style={{ borderRadius: 16, marginBottom: "1.5rem", width: "100%" }} />}
          {post.summary && <p className="display" style={{ fontSize: "1.2rem" }}>{post.summary}</p>}
          <RichText className="prose" text={post.body} />
          <Link to="/news" className="btn btn-outline">All news</Link>
        </article>
      </section>
    </div>
  );
}
