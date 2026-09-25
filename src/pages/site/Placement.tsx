import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { PageHero } from "./PageHero";
import { Button, ErrorNote, Loading, TextField } from "@/components/ui";
import { useData, usePageMeta } from "@/hooks/useData";
import { api } from "@/services/api";

interface Question { n: number; level: string; q: string; options: string[] }
interface Result { id: string; score: number; total: number; recommendedLevel: string; breakdown: Record<string, { correct: number; total: number }> }

/** Free online placement test: choose a language, answer 20–24 questions, get a recommended starting level. */
export default function Placement() {
  const languages = useData<string[]>("/public/placement");
  const [language, setLanguage] = useState<string | null>(null);
  const [person, setPerson] = useState({ name: "", email: "", phone: "" });
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const questions = useData<Question[]>(language ? `/public/placement/${encodeURIComponent(language)}` : null);
  usePageMeta("Free placement test", "Find your language level (A1–C1) in about 15 minutes with our free online placement test.");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<Result>("/public/placement", { ...person, email: person.email || undefined, phone: person.phone || undefined, language, answers });
      setResult(r);
      try {
        sessionStorage.setItem("hml_placement", JSON.stringify({ id: r.id, level: r.recommendedLevel }));
      } catch {
        // storage blocked: the result still shows
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="page-enter">
        <PageHero title="Your result" />
        <section className="section">
          <div className="narrow form-card" style={{ textAlign: "center" }}>
            <p className="muted">We recommend you start at</p>
            <p className="result-level">{result.recommendedLevel}</p>
            <p>You answered {result.score} of {result.total} questions correctly.</p>
            <div className="hbar" style={{ textAlign: "left", margin: "1.5rem 0" }}>
              {Object.entries(result.breakdown).map(([level, b]) => (
                <div className="hbar-row" key={level}>
                  <span>{level}</span>
                  <div className="progress"><span style={{ width: `${(b.correct / Math.max(b.total, 1)) * 100}%` }} /></div>
                  <strong className="small">{b.correct}/{b.total}</strong>
                </div>
              ))}
            </div>
            <div className="row" style={{ justifyContent: "center" }}>
              <Link to={`/apply?level=${result.recommendedLevel}`} className="btn btn-gold btn-lg">Apply at this level</Link>
              <Link to="/courses" className="btn btn-outline btn-lg">See courses</Link>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page-enter">
      <PageHero title="Free placement test" intro="About 15 minutes. Answer what you can — it's fine to skip questions you don't know." />
      <section className="section">
        <div className="narrow">
          {!language ? (
            <div className="form-card">
              <h2>Which language?</h2>
              {languages.loading ? <Loading /> : (
                <div className="grid">
                  {(languages.data ?? []).map((l) => (
                    <button key={l} className="tile" style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }} onClick={() => setLanguage(l)}>
                      <h3>{l}</h3>
                      <p>Levels A1–C1</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={submit}>
              <div className="form-card" style={{ marginBottom: "1rem" }}>
                <div className="row-between"><h2 style={{ margin: 0 }}>{language}</h2><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setLanguage(null); setAnswers({}); }}>Change language</button></div>
                <div className="form-grid" style={{ marginTop: "1rem" }}>
                  <TextField label="Your name" required value={person.name} onChange={(e) => setPerson({ ...person, name: e.target.value })} />
                  <TextField label="Email (to receive your result)" type="email" value={person.email} onChange={(e) => setPerson({ ...person, email: e.target.value })} />
                  <TextField label="Phone" type="tel" value={person.phone} onChange={(e) => setPerson({ ...person, phone: e.target.value })} />
                </div>
              </div>
              {questions.loading && <Loading />}
              {(questions.data ?? []).map((q, index) => (
                <fieldset className="question" key={q.n}>
                  <legend>{index + 1}. {q.q}</legend>
                  {q.options.map((option, i) => (
                    <label className="option" key={i}>
                      <input type="radio" name={`q${q.n}`} checked={answers[q.n] === i} onChange={() => setAnswers({ ...answers, [q.n]: i })} />
                      <span>{option}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
              <ErrorNote error={error} />
              {questions.data && (
                <div className="form-actions">
                  <span className="muted small">{Object.keys(answers).length} of {questions.data.length} answered</span>
                  <Button type="submit" variant="gold" size="lg" loading={busy} disabled={!person.name}>See my level</Button>
                </div>
              )}
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
