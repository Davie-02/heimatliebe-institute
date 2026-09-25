import { Link } from "react-router-dom";
import { Icon } from "@/components/Icon";
import { Reveal } from "@/components/Reveal";
import { RichText } from "@/components/RichText";
import { CourseCard } from "@/components/CourseCard";
import { useSite } from "@/context/SiteContext";
import { useData, usePageMeta } from "@/hooks/useData";
import { mediaUrl } from "@/services/api";
import { date } from "@/lib/format";
import type { Course } from "@/lib/types";

interface News { id: string; slug: string; title: string; category: string | null; summary: string | null; image: string | null; publishedAt: string }
interface Testimonial { id: string; name: string; course: string | null; body: string }
interface Notice { id: string; title: string; body: string | null }

export default function Home() {
  const { content } = useSite();
  const site = content?.site;
  const institution = content?.institution;
  const courses = useData<Course[]>("/public/r/courses", ["courses"]);
  const news = useData<News[]>("/public/r/news?pageSize=3", ["news"]);
  const testimonials = useData<Testimonial[]>("/public/r/testimonials", ["testimonials"]);
  const notices = useData<Notice[]>("/public/r/announcements", ["announcements"]);
  usePageMeta("", site?.heroTagline);

  return (
    <div className="page-enter">
      <section className="hero">
        {site?.heroImage && <img className="hero-bg" src={mediaUrl(site.heroImage)} alt="" />}
        <div className="container">
          <span className="hero-label">{site?.heroLabel ?? "German · A1 – B2 · Karonga, Malawi"}</span>
          <h1 className="hero-words">
            {(site?.heroWords ?? ["Welcome to", "Heimatliebe", "Institute"]).map((word, i) => (
              <span key={i}>{word}</span>
            ))}
          </h1>
          <p className="hero-tagline">{site?.heroTagline}</p>
          <div className="hero-actions">
            <Link to="/apply" className="btn btn-gold btn-lg">Apply now <Icon name="arrow-right" /></Link>
            <Link to="/placement-test" className="btn btn-light btn-lg">Free placement test</Link>
          </div>
          <a href="#about" className="hero-scroll" aria-label="Read more"><Icon name="chevron-down" /></a>
        </div>
      </section>

      {notices.data?.length ? (
        <div className="container" style={{ marginTop: "1.5rem" }}>
          {notices.data.slice(0, 2).map((n) => (
            <div key={n.id} className="alert alert-warning"><Icon name="megaphone" /><div><strong>{n.title}</strong>{n.body ? ` — ${n.body.slice(0, 220)}` : ""}</div></div>
          ))}
        </div>
      ) : null}

      <section className="section" id="about">
        <div className="container split">
          <Reveal>
            <span className="eyebrow">About the institute</span>
            <h2 className="section-title">{site?.aboutTitle}</h2>
            <div className="rule" />
            <RichText className="prose" text={site?.aboutBody} />
            <Link to="/about" className="btn btn-outline">More about us <Icon name="arrow-right" /></Link>
          </Reveal>
          <div className="highlights">
            {site?.stats.map((stat, i) => (
              <Reveal key={stat.label} delay={i * 90} className="highlight">
                <strong>{stat.num}</strong>
                <span>{stat.label}</span>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <Reveal>
            <span className="eyebrow">Our purpose</span>
            <h2 className="section-title">{site?.goalsTitle}</h2>
            <p className="section-intro">{site?.goalsIntro}</p>
          </Reveal>
          <div className="grid">
            {site?.goals.map((goal, i) => (
              <Reveal key={goal.title} delay={(i % 3) * 80} className="tile">
                <span className="tile-icon"><Icon name={goal.icon} /></span>
                <h3>{goal.title}</h3>
                <p>{goal.text}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <Reveal className="row-between">
            <div>
              <span className="eyebrow">Courses</span>
              <h2 className="section-title">Start learning this term</h2>
            </div>
            <Link to="/courses" className="btn btn-outline">All courses <Icon name="arrow-right" /></Link>
          </Reveal>
          <div className="grid" style={{ marginTop: "1.5rem" }}>
            {(courses.data ?? []).slice(0, 3).map((course, i) => (
              <Reveal key={course.id} delay={i * 80}>
                <CourseCard course={course} currency={institution?.currency} />
              </Reveal>
            ))}
            {courses.loading && [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 260, borderRadius: 16 }} />)}
          </div>
        </div>
      </section>

      <section className="section section-dark">
        <div className="container">
          <Reveal>
            <span className="eyebrow">Languages</span>
            <h2 className="section-title">{site?.languagesTitle}</h2>
            <p className="section-intro">{site?.languagesIntro}</p>
          </Reveal>
          <div className="grid">
            {site?.languages.map((language, i) => (
              <Reveal key={language.code} delay={(i % 3) * 80} className="language">
                <span className="language-code">{language.code}</span>
                <h3>{language.name}</h3>
                <p style={{ color: "rgba(255,255,255,.65)", fontSize: ".93rem" }}>{language.desc}</p>
                <span className={`badge ${/current/i.test(language.status) ? "live" : ""}`}>{language.status}</span>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {testimonials.data?.length ? (
        <section className="section section-alt">
          <div className="container">
            <Reveal>
              <span className="eyebrow">Students say</span>
              <h2 className="section-title">Learning that changes directions</h2>
            </Reveal>
            <div className="grid-2" style={{ marginTop: "1.5rem" }}>
              {testimonials.data.slice(0, 4).map((t, i) => (
                <Reveal key={t.id} delay={i * 80} className="quote">
                  <p>{t.body}</p>
                  <footer><strong>{t.name}</strong>{t.course && <span>· {t.course}</span>}</footer>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {news.data?.length ? (
        <section className="section">
          <div className="container">
            <Reveal className="row-between">
              <div>
                <span className="eyebrow">News</span>
                <h2 className="section-title">Latest from the institute</h2>
              </div>
              <Link to="/news" className="btn btn-outline">All news <Icon name="arrow-right" /></Link>
            </Reveal>
            <div className="grid" style={{ marginTop: "1.5rem" }}>
              {news.data.map((post, i) => (
                <Reveal key={post.id} delay={i * 80}>
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
          </div>
        </section>
      ) : null}

      <section className="section section-alt">
        <div className="container">
          <Reveal className="split">
            <div>
              <span className="eyebrow">Our vision</span>
              <h2 className="section-title">{site?.visionTitle}</h2>
              <RichText className="prose" text={site?.visionBody} />
            </div>
            <blockquote className="quote" style={{ margin: 0 }}>
              <p className="display" style={{ fontSize: "1.3rem" }}>{site?.visionQuote}</p>
            </blockquote>
          </Reveal>
          <Reveal className="cta-band" delay={100}>
            <div>
              <h2>Ready to start?</h2>
              <p>Take the free placement test, then apply online in a few minutes.</p>
            </div>
            <div className="row">
              <Link to="/placement-test" className="btn btn-light">Placement test</Link>
              <Link to="/apply" className="btn btn-gold">Apply now</Link>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
