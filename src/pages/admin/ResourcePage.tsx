import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button, Empty, ErrorNote, Loading, Modal, PageHead, Pagination } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/Toasts";
import { useStaff } from "@/context/AuthContext";
import { useSite } from "@/context/SiteContext";
import { useData, useDebounced, usePageMeta } from "@/hooks/useData";
import { useSchema, useSchemaReady } from "@/admin/SchemaContext";
import { RecordForm } from "@/admin/RecordForm";
import { FieldValue } from "@/admin/FieldValue";
import { can } from "@/admin/access";
import { download } from "@/services/api";
import { humanize } from "@/lib/format";
import type { Paged } from "@/lib/types";

type Row = Record<string, unknown> & { id: string };

/**
 * The list screen for any kind of record: search, filters, sorting, paging, spreadsheet export,
 * and adding new records — all driven by the record's description from the API.
 */
export default function ResourcePage() {
  const { resource } = useParams();
  const schema = useSchema(resource);
  const ready = useSchemaReady();
  const user = useStaff();
  const { content } = useSite();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [creating, setCreating] = useState(false);
  const debouncedQ = useDebounced(q, 300);
  usePageMeta(schema?.label ?? "Records");

  const page = Number(params.get("page") ?? 1);
  const sort = params.get("sort") ?? "";
  const dir = params.get("dir") ?? "";
  const filterValues = useMemo(() => Object.fromEntries((schema?.filters ?? []).map((f) => [f, params.get(f) ?? ""])), [schema, params]);

  useEffect(() => {
    if (debouncedQ === (params.get("q") ?? "")) return;
    const next = new URLSearchParams(params);
    if (debouncedQ) next.set("q", debouncedQ);
    else next.delete("q");
    next.delete("page");
    setParams(next, { replace: true });
  }, [debouncedQ]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = new URLSearchParams(params);
  query.set("pageSize", "25");
  const { data, loading, error } = useData<Paged<Row>>(schema ? `/r/${schema.key}?${query}` : null, schema ? [schema.key] : []);

  if (!ready) return <Loading />;
  if (!schema) return <Empty title="Unknown list" />;
  const columns = schema.fields.filter((f) => f.list);
  const mayEdit = can(user, schema.module, "edit");
  const mayExport = can(user, schema.module, "manage");

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: true });
  };
  const toggleSort = (field: string) => {
    const next = new URLSearchParams(params);
    next.set("sort", field);
    next.set("dir", sort === field && dir === "asc" ? "desc" : "asc");
    setParams(next, { replace: true });
  };

  async function exportCsv() {
    try {
      const exportQuery = new URLSearchParams(params);
      exportQuery.delete("page");
      await download(`/r/${schema!.key}/export?${exportQuery}`, `${schema!.key}.csv`);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <>
      <PageHead
        title={schema.label}
        description={schema.description}
        actions={
          <>
            {mayExport && <Button variant="outline" icon="download" onClick={() => void exportCsv()}>Export</Button>}
            {mayEdit && schema.canCreate && <Button icon="plus" onClick={() => setCreating(true)}>Add {schema.singular.toLowerCase()}</Button>}
          </>
        }
      />
      <div className="row" style={{ marginBottom: "1rem" }}>
        {schema.search?.length ? (
          <div className="search" style={{ position: "relative", flex: "1 1 240px", maxWidth: 360 }}>
            <input className="input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${schema.label}`} />
          </div>
        ) : null}
        {(schema.filters ?? []).map((name) => {
          const field = schema.fields.find((f) => f.name === name);
          if (!field || field.type === "ref") return null;
          const options = field.type === "bool" ? ["true", "false"] : field.options ?? [];
          if (!options.length) return null;
          return (
            <select key={name} className="select" style={{ width: "auto" }} value={filterValues[name]} onChange={(e) => setParam(name, e.target.value)} aria-label={field.label}>
              <option value="">{field.label}: all</option>
              {options.map((o) => <option key={o} value={o}>{field.type === "bool" ? (o === "true" ? "Yes" : "No") : field.optionLabels?.[o] ?? humanize(o)}</option>)}
            </select>
          );
        })}
      </div>
      <ErrorNote error={error} />
      {loading && !data ? <Loading /> : data?.items.length ? (
        <>
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.name}>
                      {c.type === "ref" || c.type === "image" ? c.label : (
                        <button className="sort" onClick={() => toggleSort(c.name)}>
                          {c.label}
                          {sort === c.name && <Icon name={dir === "asc" ? "arrow-up" : "chevron-down"} />}
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id} className="clickable" onClick={() => navigate(schema.key === "students" ? `/admin/students/${row.id}` : `/admin/r/${schema.key}/${row.id}`)}>
                    {columns.map((c) => (
                      <td key={c.name} data-label={c.label} className={c.type === "money" || c.type === "int" || c.type === "number" ? "num" : ""}>
                        <FieldValue field={c} row={row} currency={content?.institution.currency} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={(p) => setParam("page", String(p))} />
        </>
      ) : (
        <div className="card"><Empty title={`No ${schema.label.toLowerCase()} ${q || Object.values(filterValues).some(Boolean) ? "match" : "yet"}`} /></div>
      )}
      {creating && (
        <Modal title={`Add ${schema.singular.toLowerCase()}`} onClose={() => setCreating(false)} wide>
          <RecordForm
            schema={schema}
            presets={Object.fromEntries(Object.entries(filterValues).filter(([, v]) => v))}
            onCancel={() => setCreating(false)}
            onSaved={(row) => {
              setCreating(false);
              const invitation = (row as { invitation?: { sent: boolean; error?: string } }).invitation;
              toast(invitation ? (invitation.sent ? "Added. A welcome email with a portal link was sent." : `Added. The welcome email couldn't be sent: ${invitation.error ?? "email is not set up"}`) : `${schema.singular} added.`, invitation && !invitation.sent ? "error" : "success");
              navigate(schema.key === "students" ? `/admin/students/${row.id}` : `/admin/r/${schema.key}/${row.id}`);
            }}
          />
        </Modal>
      )}
    </>
  );
}
