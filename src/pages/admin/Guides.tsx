import { useState } from "react";
import { Button, Loading, Modal, PageHead, TextArea, TextField } from "@/components/ui";
import { RichText } from "@/components/RichText";
import { useToast } from "@/components/Toasts";
import { useStaff } from "@/context/AuthContext";
import { useData, usePageMeta } from "@/hooks/useData";
import { can, MODULE_LABELS } from "@/admin/access";
import { api } from "@/services/api";
import type { ModuleKey } from "@/lib/types";

interface Guide { key: string; module: string; title: string; body: string; edited: boolean }

/** "How do I…?" help for each area. System administrators can rewrite them. */
export default function Guides() {
  const user = useStaff();
  const toast = useToast();
  const { data, loading, reload } = useData<Guide[]>("/guides", ["guides"]);
  const [editing, setEditing] = useState<Guide | null>(null);
  const editor = can(user, "system", "edit");
  usePageMeta("Guides");
  if (loading) return <Loading />;
  const visible = (data ?? []).filter((g) => g.module === "workspace" || can(user, g.module as ModuleKey));

  async function save() {
    if (!editing) return;
    try {
      await api.put(`/guides/${editing.key}`, { title: editing.title, body: editing.body });
      toast("Guide saved.");
      setEditing(null);
      void reload();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }
  async function reset(key: string) {
    await api.del(`/guides/${key}`);
    toast("Back to the original text.");
    void reload();
  }

  return (
    <>
      <PageHead title="Guides" description="Short how-tos for everyday tasks." />
      <div className="stack">
        {visible.map((g) => (
          <details key={g.key} className="card">
            <summary style={{ cursor: "pointer" }}><strong>{g.title}</strong> <span className="badge">{g.module === "workspace" ? "Everyone" : MODULE_LABELS[g.module as ModuleKey]}</span>{g.edited && <span className="badge badge-info" style={{ marginLeft: ".3rem" }}>edited</span>}</summary>
            <RichText className="guide-body" text={g.body} />
            {editor && <div className="row"><Button size="sm" variant="outline" onClick={() => setEditing(g)}>Edit</Button>{g.edited && <Button size="sm" variant="ghost" onClick={() => void reset(g.key)}>Restore original</Button>}</div>}
          </details>
        ))}
      </div>
      {editing && (
        <Modal title="Edit guide" onClose={() => setEditing(null)} wide footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={() => void save()}>Save</Button></>}>
          <TextField label="Title" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
          <TextArea label="Text" rows={14} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} hint="Blank line between paragraphs; start lines with “- ” for a list or “1. ” for steps." />
        </Modal>
      )}
    </>
  );
}
