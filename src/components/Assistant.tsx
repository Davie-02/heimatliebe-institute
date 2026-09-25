import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "@/services/api";
import { Icon } from "./Icon";

interface Turn {
  role: "user" | "model";
  text: string;
}

const STARTERS = ["What courses do you offer?", "How much are the fees?", "When is the next exam?", "Where are you located?"];

/**
 * The website's help chat. It answers from the institute's own information only (see the API's
 * assistant service) and hides itself entirely when the service isn't switched on.
 */
export function Assistant() {
  const [status, setStatus] = useState<{ enabled: boolean; name: string; greeting: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Checked after the page has settled, so the chat never slows down the first view.
    const timer = setTimeout(() => {
      api.get<{ enabled: boolean; name: string; greeting: string }>("/assistant/status").then(setStatus).catch(() => setStatus(null));
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  if (!status?.enabled) return null;

  async function ask(question: string) {
    const message = question.trim();
    if (!message || busy) return;
    const history = turns.slice(-6);
    setTurns((t) => [...t, { role: "user", text: message }]);
    setText("");
    setBusy(true);
    try {
      const { answer } = await api.post<{ answer: string }>("/assistant/chat", { message, history });
      setTurns((t) => [...t, { role: "model", text: answer }]);
    } catch (error) {
      setTurns((t) => [...t, { role: "model", text: (error as Error).message || "Sorry, something went wrong. Please try again." }]);
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(text);
  }

  if (!open) {
    return (
      <button className="assistant-launcher" onClick={() => setOpen(true)} aria-label={status.name}>
        <Icon name="message-circle" />
        <span>Ask us</span>
      </button>
    );
  }

  return (
    <section className="assistant-panel" aria-label={status.name}>
      <div className="assistant-head">
        <div>
          <strong>{status.name}</strong>
          <small>Answers from our course and fee information</small>
        </div>
        <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close chat">
          <Icon name="x" />
        </button>
      </div>
      <div className="assistant-log" ref={log} aria-live="polite">
        <div className="bubble model">{status.greeting}</div>
        {turns.length === 0 && (
          <div className="assistant-suggestions">
            {STARTERS.map((s) => (
              <button key={s} className="chip" onClick={() => void ask(s)}>{s}</button>
            ))}
          </div>
        )}
        {turns.map((turn, i) => (
          <div key={i} className={`bubble ${turn.role}`}>{turn.text}</div>
        ))}
        {busy && (
          <div className="bubble model" aria-label="Typing">
            <span className="typing"><i /><i /><i /></span>
          </div>
        )}
      </div>
      <form className="assistant-form" onSubmit={submit}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your question…" maxLength={600} aria-label="Your question" />
        <button className="btn btn-icon" type="submit" disabled={busy || !text.trim()} aria-label="Send">
          <Icon name="arrow-right" />
        </button>
      </form>
    </section>
  );
}
