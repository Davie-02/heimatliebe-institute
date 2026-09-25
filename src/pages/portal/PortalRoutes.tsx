import { lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Shell, type NavSection } from "@/layouts/Shell";
import { Loading } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";

const Dashboard = lazy(() => import("./Dashboard"));
const Classes = lazy(() => import("./Learning"));
const Timetable = lazy(() => import("./Learning").then((m) => ({ default: m.Timetable })));
const Assignments = lazy(() => import("./Learning").then((m) => ({ default: m.Assignments })));
const Exams = lazy(() => import("./Exams"));
const TakeExam = lazy(() => import("./Exams").then((m) => ({ default: m.TakeExam })));
const Results = lazy(() => import("./Progress"));
const Attendance = lazy(() => import("./Progress").then((m) => ({ default: m.Attendance })));
const Certificates = lazy(() => import("./Progress").then((m) => ({ default: m.Certificates })));
const Fees = lazy(() => import("./Fees"));
const Receipt = lazy(() => import("./Fees").then((m) => ({ default: m.Receipt })));
const Statement = lazy(() => import("./Fees").then((m) => ({ default: m.Statement })));
const Library = lazy(() => import("./More").then((m) => ({ default: m.Library })));
const Scholarships = lazy(() => import("./More").then((m) => ({ default: m.Scholarships })));
const Apps = lazy(() => import("./More").then((m) => ({ default: m.Apps })));
const Announcements = lazy(() => import("./More").then((m) => ({ default: m.Announcements })));
const Profile = lazy(() => import("./More").then((m) => ({ default: m.Profile })));
const Messages = lazy(() => import("../shared/Messages"));
const Security = lazy(() => import("../shared/Security"));

const SECTIONS: NavSection[] = [
  { key: "main", items: [{ to: "/portal", label: "Home", icon: "home", end: true }, { to: "/portal/announcements", label: "Announcements", icon: "megaphone" }, { to: "/portal/messages", label: "Messages", icon: "message-square" }] },
  {
    key: "learning",
    title: "Learning",
    items: [
      { to: "/portal/classes", label: "My classes", icon: "users" },
      { to: "/portal/timetable", label: "Timetable", icon: "calendar" },
      { to: "/portal/assignments", label: "Assignments", icon: "edit" },
      { to: "/portal/exams", label: "Exams & quizzes", icon: "check-square" },
      { to: "/portal/library", label: "Library", icon: "book-open" },
      { to: "/portal/apps", label: "Apps & links", icon: "grid" },
    ],
  },
  {
    key: "progress",
    title: "Progress",
    items: [
      { to: "/portal/results", label: "Results", icon: "trending-up" },
      { to: "/portal/attendance", label: "Attendance", icon: "user-check" },
      { to: "/portal/certificates", label: "Certificates", icon: "award" },
    ],
  },
  {
    key: "money",
    title: "Fees",
    items: [
      { to: "/portal/fees", label: "Fees & payments", icon: "wallet" },
      { to: "/portal/scholarships", label: "Scholarships", icon: "gift" },
    ],
  },
  { key: "account", title: "Account", items: [{ to: "/portal/profile", label: "My details", icon: "user" }, { to: "/portal/security", label: "Password & security", icon: "lock" }] },
];

const TABBAR = [
  { to: "/portal", label: "Home", icon: "home" as const, end: true },
  { to: "/portal/timetable", label: "Timetable", icon: "calendar" as const },
  { to: "/portal/assignments", label: "Tasks", icon: "edit" as const },
  { to: "/portal/fees", label: "Fees", icon: "wallet" as const },
  { to: "/portal/messages", label: "Messages", icon: "message-square" as const },
];

/** The student portal. Only signed-in students get in; everyone else goes to the sign-in page. */
export default function PortalRoutes() {
  const { session, checking } = useAuth();
  const location = useLocation();
  if (checking) return <Loading />;
  if (session.kind === "staff") return <Navigate to="/admin" replace />;
  if (session.kind !== "student") return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname)}`} replace />;
  return (
    <Routes>
      <Route element={<Shell sections={SECTIONS} home="/portal" messagesPath="/portal/messages" className="portal" tabbar={TABBAR} />}>
        <Route index element={<Dashboard />} />
        <Route path="classes" element={<Classes />} />
        <Route path="timetable" element={<Timetable />} />
        <Route path="assignments" element={<Assignments />} />
        <Route path="exams" element={<Exams />} />
        <Route path="exams/:id" element={<TakeExam />} />
        <Route path="results" element={<Results />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="certificates" element={<Certificates />} />
        <Route path="fees" element={<Fees />} />
        <Route path="fees/receipt/:id" element={<Receipt />} />
        <Route path="fees/statement" element={<Statement />} />
        <Route path="library" element={<Library />} />
        <Route path="scholarships" element={<Scholarships />} />
        <Route path="apps" element={<Apps />} />
        <Route path="announcements" element={<Announcements />} />
        <Route path="messages" element={<Messages />} />
        <Route path="profile" element={<Profile />} />
        <Route path="security" element={<Security />} />
        <Route path="*" element={<Navigate to="/portal" replace />} />
      </Route>
    </Routes>
  );
}
