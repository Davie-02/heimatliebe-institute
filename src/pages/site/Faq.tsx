import { PageHero } from "./PageHero";
import { Empty, Loading } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useData, usePageMeta } from "@/hooks/useData";
import { Link } from "react-router-dom";

interface Faq { id: string; question: string; answer: string; category: string | null }

export default function FaqPage() {
  const { data, loading } = useData<Faq[]>("/public/r/faq", ["faq"]);
  usePageMeta("Questions & answers", "Answers to common questions about courses, fees, placement tests and exams.");
  const groups = new Map<string, Faq[]>();
  for (const item of data ?? []) {
    const key = item.category ?? "General";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return (
    <div className="page-enter">
      <PageHero title="Questions & answers" intro="Can't find your answer? Ask us on WhatsApp, use the chat, or send a message." />
      <section className="section">
        <div className="narrow">
          {loading ? <Loading /> : data?.length ? (
            [...groups.entries()].map(([category, items]) => (
              <div key={category} style={{ marginBottom: "2rem" }}>
                {groups.size > 1 && <h2>{category}</h2>}
                {items.map((item) => (
                  <details className="faq-item" key={item.id}>
                    <summary>{item.question}<Icon name="plus" /></summary>
                    <p>{item.answer}</p>
                  </details>
                ))}
              </div>
            ))
          ) : <Empty icon="info" title="No questions yet" />}
          <Link to="/contact" className="btn btn-outline">Ask a question</Link>
        </div>
      </section>
    </div>
  );
}
