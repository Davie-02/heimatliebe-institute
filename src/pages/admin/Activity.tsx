import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Check, Empty, Loading, PageHead } from "@/components/ui";
import { useToast } from "@/components/Toasts";
import { useStaff } from "@/context/AuthContext";
import { useData, usePageMeta } from "@/hooks/useData";
import { can } from "@/admin/access";
import { api } from "@/services/api";
import { dateTime, relative } from "@/lib/format";

interface Item { id: string; actorName: string | null; actorKind: string; action: string; summary: string; entity: string | null; entityId: string | null; createdAt: string; undoneAt: string | null; undoneBy: string | null; canUndo: boolean }

/** Who changed what, and undo. Everyone sees their own; system staff see everyone's. */
export default function Activity() {
  const user = useStaff();
  const toast = useToast();
  const seeAll = can(user, "system");
  const [mine, setMine] = useState(!seeAll);
  const [cursor, setCursor] = useState<string | null>(null);
  const { data, loading, reload } = useData<{ items: Item[]; next: string | null }>(`/activity?mine=${mine}${cursor ? `&cursor=${cursor}` : ""}`, ["activity"]);
  const [busy, setBusy] = useState<string | null>(null);
  usePageMeta("Activity & undo");

  async function undo(item: Item) {
    setBusy(item.id);
    try {
      await api.post(`/activity/${item.id}/undo`);
      toast("Undone.");
      void reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const link = (item: Item) => (item.entity && item.entityId && !["site-content", "staff"].includes(item.entity) ? (item.entity === "students" ? `/admin/students/${item.entityId}` : `/admin/r/${item.entity}/${item.entityId}`) : null);

  return (
    <>
      <PageHead title="Activity & undo" description="Every change is recorded. Made a mistake? Undo it here." actions={seeAll ? <Check label="Only my actions" checked={mine} onChange={(e) => { setMine(e.target.checked); setCursor(null); }} /> : undefined} />
      {loading ? <Loading /> : data?.items.length ? (
        <>
          <div className="card">
            <ul className="list">
              {data.items.map((item) => {
                const to = link(item);
                return (
                  <li key={item.id}>
                    <div>
                      {to ? <Link to={to}>{item.summary}</Link> : item.summary}
                      <div className="muted small">{item.actorName ?? (item.actorKind === "public" ? "Website visitor" : "System")} · <span title={dateTime(item.createdAt)}>{relative(item.createdAt)}</span>{item.undoneAt && ` · undone by ${item.undoneBy}`}</div>
                    </div>
                    {item.canUndo && <Button size="sm" variant="outline" icon="refresh" loading={busy === item.id} onClick={() => void undo(item)}>Undo</Button>}
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="pagination">
            {cursor ? <Button variant="outline" size="sm" onClick={() => setCursor(null)}>Newest</Button> : <span />}
            {data.next && <Button variant="outline" size="sm" onClick={() => setCursor(data.next)}>Older</Button>}
          </div>
        </>
      ) : <div className="card"><Empty icon="refresh" title="Nothing recorded yet" /></div>}
    </>
  );
}
