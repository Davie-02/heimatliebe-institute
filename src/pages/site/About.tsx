import { Link } from "react-router-dom";
import { PageHero } from "./PageHero";
import { Reveal } from "@/components/Reveal";
import { RichText } from "@/components/RichText";
import { Icon } from "@/components/Icon";
import { useSite } from "@/context/SiteContext";
import { usePageMeta } from "@/hooks/useData";

export default function About() {
  const { content } = useSite();
  const site = content?.site;
  usePageMeta("About us", site?.aboutTitle);
  return (
    <div className="page-enter">
      <PageHero title="About Heimatliebe" intro={site?.aboutTitle} />
      <section className="section">
        <div className="container split">
          <Reveal><RichText className="prose" text={site?.aboutBody} /></Reveal>
          <div className="highlights">
            {site?.stats.map((s, i) => (
              <Reveal key={s.label} delay={i * 90} className="highlight"><strong>{s.num}</strong><span>{s.label}</span></Reveal>
            ))}
          </div>
        </div>
      </section>
      <section className="section section-alt">
        <div className="container">
          <Reveal><span className="eyebrow">Our goals</span><h2 className="section-title">{site?.goalsTitle}</h2><p className="section-intro">{site?.goalsIntro}</p></Reveal>
          <div className="grid">
            {site?.goals.map((g, i) => (
              <Reveal key={g.title} delay={(i % 3) * 70} className="tile"><span className="tile-icon"><Icon name={g.icon} /></span><h3>{g.title}</h3><p>{g.text}</p></Reveal>
            ))}
          </div>
        </div>
      </section>
      <section className="section">
        <div className="container split">
          <Reveal>
            <span className="eyebrow">Vision</span>
            <h2 className="section-title">{site?.visionTitle}</h2>
            <RichText className="prose" text={site?.visionBody} />
          </Reveal>
          <Reveal className="quote" delay={100}><p className="display" style={{ fontSize: "1.25rem" }}>{site?.visionQuote}</p></Reveal>
        </div>
        <div className="container" style={{ marginTop: "2rem" }}>
          <Reveal className="cta-band">
            <div><h2>Visit us in Karonga</h2><p>{site?.contactAddress}</p></div>
            <Link to="/contact" className="btn btn-gold">Contact us</Link>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
