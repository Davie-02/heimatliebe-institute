import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert, Avatar, Button, Empty, ErrorNote, Loading, Modal, PageHead, SelectField, TextField } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/Toasts";
import { useStaff } from "@/context/AuthContext";
import { useData, useDebounced, usePageMeta } from "@/hooks/useData";
import { can, LEVELS } from "@/admin/access";
import { api, ApiError } from "@/services/api";
import { date, relative } from "@/lib/format";
import type { AccessMap, Level, ModuleKey } from "@/lib/types";

interface Meta { modules: Array<{ key: ModuleKey; label: string; description: string }>; levels: Level[]; departments: Array<{ key: string; label: string; access: Partial<AccessMap> }> }
interface StaffRow { id: string; staffNo: string | null; name: string; email: string; phone: string | null; role: "OWNER" | "MANAGER" | "EMPLOYEE"; department: string; jobTitle: string | null; bio: string | null; photoUrl: string | null; permissions: Partial<AccessMap>; isActive: boolean; mustChangePassword: boolean; totpEnabled: boolean; lastLoginAt: string | null; createdAt: string; access: AccessMap }

const ROLE_LABELS = { OWNER: "System administrator", MANAGER: "Manager", EMPLOYEE: "Staff" };

/**
 * Confirm-it's-you for sensitive actions. `run` performs the action; if the server asks for
 * confirmation first, a password (+ code) prompt appears and the action is retried after it.
 */
export function useStepUp() {
  const [pending, setPending] = useState<null | (() => Promise<void>)>(null);
  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (err) {
      if (err instanceof ApiError && err.code === "STEP_UP_REQUIRED") setPending(() => action);
      else throw err;
    }
  }
  const dialog = pending ? <StepUpDialog onClose={() => setPending(null)} onConfirmed={async () => { const action = pending; setPending(null); await action(); }} /> : null;
  return { run, dialog };
}

function StepUpDialog({ onClose, onConfirmed }: { onClose: () => void; onConfirmed: () => Promise<void> }) {
  const user = useStaff();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/confirm-identity", { password, code: code || undefined });
      await onConfirmed();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Confirm it's you" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted">Changing access is sensitive. Confirm with your password{user.twoFactorEnabled ? " and authenticator code" : ""}; this lasts 10 minutes.</p>
        <ErrorNote error={error} />
        <TextField label="Your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {user.twoFactorEnabled && <TextField label="Authenticator code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} required />}
        <div className="form-actions"><Button type="submit" loading={busy}>Confirm</Button></div>
      </form>
    </Modal>
  );
}

export default function Staff() {
  const user = useStaff();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const debounced = useDebounced(q, 250);
  const [active, setActive] = useState("true");
  const { data, loading } = useData<StaffRow[]>(`/staff-accounts?active=${active}&q=${encodeURIComponent(debounced)}`, ["staff"]);
  const meta = useData<Meta>("/staff-accounts/meta");
  const [inviting, setInviting] = useState(false);
  const mayInvite = can(user, "hr", "manage") || can(user, "system", "manage");
  usePageMeta("Staff & access");
  const deptLabel = (key: string) => meta.data?.departments.find((d) => d.key === key)?.label ?? key;
  return (
    <>
      <PageHead title="Staff & access" description="Everyone who works here, their department and what they can open." actions={mayInvite ? <Button icon="user-plus" onClick={() => setInviting(true)}>Invite staff</Button> : undefined} />
      <div className="row" style={{ marginBottom: "1rem" }}>
        <input className="input" style={{ maxWidth: 320 }} placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search staff" />
        <select className="select" style={{ width: "auto" }} value={active} onChange={(e) => setActive(e.target.value)} aria-label="Show"><option value="true">Active</option><option value="false">Deactivated</option><option value="">Everyone</option></select>
      </div>
      {loading ? <Loading /> : data?.length ? (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>Name</th><th>Department</th><th>Role</th><th>Two-step</th><th>Last sign-in</th></tr></thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => navigate(`/admin/staff/${s.id}`)}>
                  <td data-label="Name"><Link to={`/admin/staff/${s.id}`} className="row" style={{ color: "inherit", textDecoration: "none" }} onClick={(e) => e.stopPropagation()}><Avatar name={s.name} src={s.photoUrl} size={30} /><span>{s.name}<br /><span className="muted small">{s.jobTitle ?? s.email}</span></span></Link></td>
                  <td data-label="Department">{deptLabel(s.department)}</td>
                  <td data-label="Role">{s.role === "OWNER" ? <span className="badge badge-brand">{ROLE_LABELS[s.role]}</span> : ROLE_LABELS[s.role]}{s.mustChangePassword && <span className="badge badge-warning" style={{ marginLeft: ".3rem" }}>Invited</span>}</td>
                  <td data-label="Two-step">{s.totpEnabled ? <span className="badge badge-success">On</span> : <span className="badge">Off</span>}</td>
                  <td data-label="Last sign-in">{s.lastLoginAt ? relative(s.lastLoginAt) : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="card"><Empty icon="users" title="Nobody here" /></div>}
      {inviting && meta.data && <InviteDialog meta={meta.data} onClose={() => setInviting(false)} />}
    </>
  );
}

function InviteDialog({ meta, onClose }: { meta: Meta; onClose: () => void }) {
  const user = useStaff();
  const navigate = useNavigate();
  const toast = useToast();
  const stepUp = useStepUp();
  const [form, setForm] = useState({ name: "", email: "", department: "teaching", role: "EMPLOYEE", jobTitle: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [temp, setTemp] = useState<{ id: string; password: string } | null>(null);
  const isAdmin = can(user, "system", "manage");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await stepUp.run(async () => {
        const result = await api.post<{ staff: { id: string }; emailSent: boolean; emailError?: string; tempPassword?: string }>("/staff-accounts", { ...form, jobTitle: form.jobTitle || undefined, phone: form.phone || undefined });
        if (result.emailSent) {
          toast("Invitation sent. They'll choose their own password at first sign-in.");
          navigate(`/admin/staff/${result.staff.id}`);
        } else setTemp({ id: result.staff.id, password: result.tempPassword ?? "" });
      });
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }
  if (temp) {
    return (
      <Modal title="Account created" onClose={() => navigate(`/admin/staff/${temp.id}`)}>
        <Alert tone="warning">The invitation email couldn't be sent. Give this one-time password to the person privately; it works for 72 hours and must be changed at first sign-in.</Alert>
        <p className="mono" style={{ fontSize: "1.2rem", background: "var(--surface-3)", padding: ".8rem", borderRadius: 8 }}>{temp.password}</p>
        <Button onClick={() => navigate(`/admin/staff/${temp.id}`)}>Done</Button>
      </Modal>
    );
  }
  return (
    <Modal title="Invite a staff member" onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorNote error={error} />
        <div className="form-grid">
          <TextField label="Full name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField label="Email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <SelectField label="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} options={meta.departments.map((d) => ({ value: d.key, label: d.label }))} hint="Decides what they can open. You can adjust it per person afterwards." />
          {isAdmin && <SelectField label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} options={[{ value: "EMPLOYEE", label: "Staff" }, { value: "MANAGER", label: "Manager (management access)" }, ...(user.role === "OWNER" ? [{ value: "OWNER", label: "System administrator" }] : [])]} />}
          <TextField label="Job title" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
          <TextField label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div className="form-actions"><Button type="submit" loading={busy}>Send invitation</Button></div>
      </form>
      {stepUp.dialog}
    </Modal>
  );
}

export function StaffMember() {
  const { id } = useParams();
  const user = useStaff();
  const toast = useToast();
  const stepUp = useStepUp();
  const { data: staff, loading, reload } = useData<StaffRow>(`/staff-accounts/${id}`, ["staff"]);
  const meta = useData<Meta>("/staff-accounts/meta");
  const [form, setForm] = useState<{ department: string; role: string; permissions: Partial<AccessMap>; jobTitle: string; phone: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isAdmin = user.role === "OWNER" || can(user, "system", "manage");
  const mayEdit = isAdmin || can(user, "hr", "manage");
  usePageMeta(staff?.name ?? "Staff member");
  useEffect(() => {
    if (staff) setForm({ department: staff.department, role: staff.role, permissions: staff.permissions ?? {}, jobTitle: staff.jobTitle ?? "", phone: staff.phone ?? "", name: staff.name });
  }, [staff]);
  if (loading || !staff || !form || !meta.data) return <Loading />;
  const isSelf = staff.id === user.id;
  const dept = meta.data.departments.find((d) => d.key === form.department);
  const base = (module: ModuleKey): Level => {
    if (form.role === "OWNER") return "manage";
    const management = form.role === "MANAGER" ? meta.data!.departments.find((d) => d.key === "management")?.access[module] : undefined;
    const fromDept = dept?.access[module];
    return [management, fromDept].reduce<Level>((best, l) => (l && LEVELS.indexOf(l) > LEVELS.indexOf(best) ? l : best), "none");
  };

  async function save(body: Record<string, unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await stepUp.run(async () => {
        await api.patch(`/staff-accounts/${id}`, body);
        toast(message);
        void reload();
      });
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }
  async function action(path: string, message: string) {
    setBusy(true);
    try {
      await stepUp.run(async () => {
        const result = await api.post<{ emailSent?: boolean; tempPassword?: string }>(`/staff-accounts/${id}/${path}`);
        toast(result.tempPassword ? `Email failed. One-time password: ${result.tempPassword}` : message, result.tempPassword ? "error" : "success");
      });
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="breadcrumb" style={{ marginBottom: ".5rem" }}><Link to="/admin/staff"><Icon name="chevron-left" /> Staff</Link></div>
      <PageHead
        title={<span className="row"><Avatar name={staff.name} src={staff.photoUrl} size={48} />{staff.name}</span>}
        description={`${staff.email}${staff.staffNo ? ` · ${staff.staffNo}` : ""} · joined ${date(staff.createdAt)}${staff.lastLoginAt ? ` · last sign-in ${relative(staff.lastLoginAt)}` : ""}`}
        actions={mayEdit && !isSelf ? (
          <>
            {staff.mustChangePassword && <Button variant="outline" icon="mail" loading={busy} onClick={() => void action("resend-invitation", "A new invitation was sent.")}>Resend invitation</Button>}
            {isAdmin && staff.totpEnabled && <Button variant="outline" icon="shield" loading={busy} onClick={() => void action("reset-2fa", "Two-step verification was reset. They'll set it up again.")}>Reset two-step</Button>}
            <Button variant={staff.isActive ? "danger" : ""} loading={busy} onClick={() => void save({ isActive: !staff.isActive }, staff.isActive ? "Deactivated. They've been signed out." : "Reactivated.")}>{staff.isActive ? "Deactivate" : "Reactivate"}</Button>
          </>
        ) : undefined}
      />
      {!staff.isActive && <Alert tone="warning">This account is deactivated and can't sign in.</Alert>}
      <ErrorNote error={error} />
      <div className="grid-2">
        <section className="card">
          <h2>Details</h2>
          <fieldset disabled={!mayEdit} style={{ border: 0, padding: 0, margin: 0 }}>
            <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <TextField label="Job title" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
            <TextField label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            {mayEdit && <div className="form-actions"><Button loading={busy} onClick={() => void save({ name: form.name, jobTitle: form.jobTitle, phone: form.phone }, "Saved.")}>Save details</Button></div>}
          </fieldset>
        </section>
        <section className="card">
          <h2>Access</h2>
          {!isAdmin && <Alert>Only a system administrator can change access.</Alert>}
          {isSelf && <Alert>You can't change your own access.</Alert>}
          <fieldset disabled={!isAdmin || isSelf} style={{ border: 0, padding: 0, margin: 0 }}>
            <div className="form-grid">
              <SelectField label="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} options={meta.data.departments.map((d) => ({ value: d.key, label: d.label }))} />
              <SelectField label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} options={[{ value: "EMPLOYEE", label: "Staff" }, { value: "MANAGER", label: "Manager" }, { value: "OWNER", label: "System administrator" }]} />
            </div>
            {form.role !== "OWNER" && (
              <div className="table-wrap">
                <table className="table matrix">
                  <thead><tr><th>Area</th><th>From department</th><th>This person</th></tr></thead>
                  <tbody>
                    {meta.data.modules.map((m) => {
                      const override = form.permissions[m.key];
                      const effective = override ?? base(m.key);
                      return (
                        <tr key={m.key}>
                          <td title={m.description}>{m.label}</td>
                          <td><span className={`level level-${base(m.key)}`}>{base(m.key)}</span></td>
                          <td>
                            <select className="select" style={{ minHeight: 34, padding: ".2rem .5rem" }} value={override ?? ""} onChange={(e) => setForm({ ...form, permissions: { ...form.permissions, [m.key]: (e.target.value || undefined) as Level | undefined } })} aria-label={`${m.label} access`}>
                              <option value="">Same ({base(m.key)})</option>
                              {meta.data!.levels.map((l) => <option key={l} value={l}>{l}</option>)}
                            </select>
                            {override && <span className={`level level-${effective}`} style={{ marginLeft: ".4rem" }}>{effective}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {isAdmin && !isSelf && (
              <div className="form-actions">
                <Button loading={busy} onClick={() => void save({ department: form.department, role: form.role, permissions: Object.fromEntries(Object.entries(form.permissions).filter(([, v]) => v)) }, "Access updated. It takes effect immediately.")}>Save access</Button>
              </div>
            )}
          </fieldset>
        </section>
      </div>
      {stepUp.dialog}
    </>
  );
}
