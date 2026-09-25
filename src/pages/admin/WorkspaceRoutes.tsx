import { lazy, Suspense, useMemo } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Shell, type NavSection } from "@/layouts/Shell";
import { Loading } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useData } from "@/hooks/useData";
import { SchemaProvider } from "@/admin/SchemaContext";
import { MODULE_NAV, WORKSPACE_LINKS } from "@/admin/nav";
import { can } from "@/admin/access";
import type { StaffUser } from "@/lib/types";

const Dashboard = lazy(() => import("./Dashboard"));
const ModuleHome = lazy(() => import("./Dashboard").then((m) => ({ default: m.ModuleHome })));
const ResourcePage = lazy(() => import("./ResourcePage"));
const RecordPage = lazy(() => import("./RecordPage"));
const StudentOverview = lazy(() => import("./StudentOverview"));
const MyClasses = lazy(() => import("./Teaching"));
const ClassPage = lazy(() => import("./Teaching").then((m) => ({ default: m.ClassPage })));
const ExamBuilder = lazy(() => import("./ExamBuilder"));
const Marking = lazy(() => import("./ExamBuilder").then((m) => ({ default: m.Marking })));
const FinanceOverview = lazy(() => import("./Finance"));
const PaymentsQueue = lazy(() => import("./Finance").then((m) => ({ default: m.PaymentsQueue })));
const BulkInvoice = lazy(() => import("./Finance").then((m) => ({ default: m.BulkInvoice })));
const StaffStatement = lazy(() => import("./Finance").then((m) => ({ default: m.StaffStatement })));
const StaffReceipt = lazy(() => import("./Finance").then((m) => ({ default: m.StaffReceipt })));
const Website = lazy(() => import("./Website"));
const Settings = lazy(() => import("./Website").then((m) => ({ default: m.InstituteSettings })));
const Staff = lazy(() => import("./Staff"));
const StaffMember = lazy(() => import("./Staff").then((m) => ({ default: m.StaffMember })));
const MyAccount = lazy(() => import("./People"));
const Leave = lazy(() => import("./People").then((m) => ({ default: m.LeaveApprovals })));
const Directory = lazy(() => import("./People").then((m) => ({ default: m.Directory })));
const Security = lazy(() => import("./Security"));
const Activity = lazy(() => import("./Activity"));
const Guides = lazy(() => import("./Guides"));
const Assistant = lazy(() => import("./Assistant"));
const Reports = lazy(() => import("./Reports"));
const System = lazy(() => import("./System"));
const Messages = lazy(() => import("../shared/Messages"));

interface Overview {
  admissions?: { pending: number };
  finance?: { pendingPayments: number };
  teaching?: { toMark: number };
  hr?: { pendingLeave: number };
  assistant?: { drafts: number };
}

/** Sidebar sections: personal links, then every area this person may open. */
function useSections(user: StaffUser): NavSection[] {
  const { data } = useData<Overview>("/workspace/overview", ["applications", "payments", "assignments", "exams", "leave-requests", "faq-suggestions"]);
  return useMemo(() => {
    const counts: Record<string, number | undefined> = {
      "/admin/r/applications": data?.admissions?.pending,
      "/admin/finance/payments": data?.finance?.pendingPayments,
      "/admin/teaching": data?.teaching?.toMark,
      "/admin/leave": data?.hr?.pendingLeave,
      "/admin/assistant": data?.assistant?.drafts,
    };
    const sections: NavSection[] = [{ key: "workspace", items: WORKSPACE_LINKS.map((l) => ({ ...l, end: l.to === "/admin" })) }];
    for (const module of MODULE_NAV) {
      if (!can(user, module.key, "view")) continue;
      const pages = module.pages.filter((p) => can(user, module.key, p.level ?? "view"));
      // "Staff" appears under both HR and System; show it once.
      const items = pages.filter((p) => !(module.key === "system" && p.to === "/admin/staff" && can(user, "hr")));
      if (items.length) sections.push({ key: module.key, title: module.label, items: items.map((p) => ({ to: p.to, label: p.label, icon: p.icon, count: counts[p.to] })) });
    }
    return sections;
  }, [user, data]);
}

/**
 * System administrators must set up two-step verification before anything else. Until then only
 * this page is shown, and nothing else is requested from the server (it would be refused anyway).
 */
function TwoFactorSetupOnly() {
  const { signOut } = useAuth();
  const location = useLocation();
  if (location.pathname !== "/admin/security") return <Navigate to="/admin/security" replace />;
  return (
    <main id="main" className="ws-main" style={{ margin: "0 auto" }}>
      <div className="row-between" style={{ marginBottom: "1rem" }}>
        <span className="brand" style={{ color: "var(--text)" }}><img src="/img/logo.webp" alt="" width="38" height="38" /> Heimatliebe</span>
        <button className="btn btn-ghost btn-sm" onClick={() => void signOut()}>Sign out</button>
      </div>
      <Suspense fallback={<Loading />}><Security /></Suspense>
    </main>
  );
}

function Workspace({ user }: { user: StaffUser }) {
  const sections = useSections(user);
  return (
    <Routes>
      <Route element={<Shell sections={sections} home="/admin" messagesPath="/admin/messages" search />}>
        <Route index element={<Dashboard />} />
        <Route path="m/:module" element={<ModuleHome />} />
        <Route path="r/:resource" element={<ResourcePage />} />
        <Route path="r/:resource/:id" element={<RecordPage />} />
        <Route path="students/:id" element={<StudentOverview />} />
        <Route path="teaching" element={<MyClasses />} />
        <Route path="teaching/:classId" element={<ClassPage />} />
        <Route path="teaching/exams/:examId" element={<ExamBuilder />} />
        <Route path="teaching/exams/:examId/marking" element={<Marking />} />
        <Route path="finance" element={<FinanceOverview />} />
        <Route path="finance/payments" element={<PaymentsQueue />} />
        <Route path="finance/bulk" element={<BulkInvoice />} />
        <Route path="finance/statement/:studentId" element={<StaffStatement />} />
        <Route path="finance/receipt/:id" element={<StaffReceipt />} />
        <Route path="website" element={<Website />} />
        <Route path="settings" element={<Settings />} />
        <Route path="staff" element={<Staff />} />
        <Route path="staff/:id" element={<StaffMember />} />
        <Route path="leave" element={<Leave />} />
        <Route path="me" element={<MyAccount />} />
        <Route path="directory" element={<Directory />} />
        <Route path="security" element={<Security />} />
        <Route path="activity" element={<Activity />} />
        <Route path="guides" element={<Guides />} />
        <Route path="assistant" element={<Assistant />} />
        <Route path="reports" element={<Reports />} />
        <Route path="system" element={<System />} />
        <Route path="messages" element={<Messages />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}

/** The staff workspace. Only signed-in staff get in. */
export default function WorkspaceRoutes() {
  const { session, checking } = useAuth();
  const location = useLocation();
  if (checking) return <Loading />;
  if (session.kind === "student") return <Navigate to="/portal" replace />;
  if (session.kind !== "staff") return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (session.user.mustSetUpTwoFactor) return <TwoFactorSetupOnly />;
  return (
    <SchemaProvider>
      <Workspace user={session.user} />
    </SchemaProvider>
  );
}
