import { useEffect, useRef, useState, type FormEvent } from "react";
import { Avatar, Button, Empty, ErrorNote, Loading, Modal, PageHead } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useAuth } from "@/context/AuthContext";
import { useData, useDebounced } from "@/hooks/useData";
import { api } from "@/services/api";
import { dateTime, relative } from "@/lib/format";

interface Conversation { id: string; subject: string | null; updatedAt: string; with: Array<{ kind: string; id: string; name: string }>; last: { body: string; senderName: string; createdAt: string } | null; unread: boolean }
interface Thread { conversation: { id: string; subject: string | null; participants: Array<{ name: string }> }; messages: Array<{ id: string; body: string; senderName: string; createdAt: string; mine: boolean }> }
interface Recipient { kind: "staff" | "student"; id: string; name: string; detail: string }

/** Private conversations. Used by both students and staff; new messages appear instantly. */
export default function Messages() {
  const { session } = useAuth();
  const me = session.kind === "none" ? null : session;
  const topic = me ? `messages:${me.kind}:${me.user.id}` : "";
  const list = useData<Conversation[]>("/messages", [topic]);
  const [openId, setOpenId] = useState<string | null>(null);
  const thread = useData<Thread>(openId ? `/messages/${openId}` : null, [topic]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [composing, setComposing] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [thread.data]);
  useEffect(() => {
    if (openId && list.data?.some((c) => c.id === openId && c.unread)) void thread.reload();
  }, [list.data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!openId || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/messages/${openId}`, { body: text });
      setText("");
      await Promise.all([thread.reload(), list.reload()]);
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title="Messages" description={me?.kind === "student" ? "Write to your teachers and the office." : "Conversations with colleagues and students."} actions={<Button icon="plus" onClick={() => setComposing(true)}>New message</Button>} />
      {list.loading ? <Loading /> : !list.data?.length ? (
        <div className="card"><Empty icon="message-square" title="No messages yet">Start a conversation with the button above.</Empty></div>
      ) : (
        <div className="chat" data-open={String(Boolean(openId))}>
          <div className="chat-list">
            {list.data.map((c) => (
              <button key={c.id} className={`chat-item ${c.unread ? "unread" : ""} ${c.id === openId ? "active" : ""}`} onClick={() => setOpenId(c.id)}>
                <strong>{c.with.map((p) => p.name).join(", ") || "Just you"}</strong>
                {c.subject && <small>{c.subject}</small>}
                <small>{c.last ? `${c.last.senderName}: ${c.last.body}` : ""}</small>
                <small>{relative(c.updatedAt)}</small>
              </button>
            ))}
          </div>
          <div className="chat-thread">
            {!openId ? <Empty icon="message-circle" title="Choose a conversation" /> : thread.loading ? <Loading /> : thread.data && (
              <>
                <div className="card-head" style={{ padding: ".8rem 1rem", margin: 0, borderBottom: "1px solid var(--border)" }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setOpenId(null)}><Icon name="chevron-left" /> Back</button>
                  <strong>{thread.data.conversation.subject ?? thread.data.conversation.participants.map((p) => p.name).join(", ")}</strong>
                </div>
                <div className="chat-messages">
                  {thread.data.messages.map((m) => (
                    <div key={m.id} className={`bubble ${m.mine ? "mine" : "theirs"}`}>
                      {!m.mine && <strong className="small">{m.senderName}</strong>}
                      <div>{m.body}</div>
                      <small>{dateTime(m.createdAt)}</small>
                    </div>
                  ))}
                  <div ref={end} />
                </div>
                <form className="assistant-form" onSubmit={send}>
                  <textarea className="textarea" style={{ minHeight: 44 }} rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message…" aria-label="Message" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(e as unknown as FormEvent); } }} />
                  <Button type="submit" loading={busy} disabled={!text.trim()} aria-label="Send"><Icon name="arrow-right" /></Button>
                </form>
                <ErrorNote error={error} />
              </>
            )}
          </div>
        </div>
      )}
      {composing && <Compose onClose={() => setComposing(false)} onSent={(id) => { setComposing(false); setOpenId(id); void list.reload(); }} />}
    </>
  );
}

function Compose({ onClose, onSent }: { onClose: () => void; onSent: (id: string) => void }) {
  const [q, setQ] = useState("");
  const debounced = useDebounced(q, 250);
  const options = useData<Recipient[]>(`/messages/recipients?q=${encodeURIComponent(debounced)}`);
  const [to, setTo] = useState<Recipient[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ conversationId: string }>("/messages", { to: to.map(({ kind, id }) => ({ kind, id })), subject: subject || undefined, body });
      onSent(result.conversationId);
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New message" onClose={onClose}>
      <form onSubmit={send}>
        <ErrorNote error={error} />
        <div className="field">
          <label>To</label>
          <div className="row" style={{ marginBottom: ".4rem" }}>
            {to.map((r) => <span key={r.id} className="badge badge-brand">{r.name} <button type="button" className="btn-ghost" style={{ border: 0, background: "none", cursor: "pointer" }} onClick={() => setTo(to.filter((x) => x.id !== r.id))} aria-label={`Remove ${r.name}`}>×</button></span>)}
          </div>
          <input className="input" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
          <ul className="list" style={{ maxHeight: 180, overflowY: "auto" }}>
            {(options.data ?? []).filter((o) => !to.some((t) => t.id === o.id)).slice(0, 8).map((o) => (
              <li key={`${o.kind}-${o.id}`}>
                <span className="row"><Avatar name={o.name} size={28} /> {o.name} <span className="muted small">{o.detail}</span></span>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setTo([...to, o])}>Add</button>
              </li>
            ))}
          </ul>
        </div>
        <div className="field"><label>Subject (optional)</label><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div className="field"><label className="required">Message</label><textarea className="textarea" value={body} onChange={(e) => setBody(e.target.value)} required /></div>
        <div className="form-actions"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy} disabled={!to.length || !body.trim()}>Send</Button></div>
      </form>
    </Modal>
  );
}
