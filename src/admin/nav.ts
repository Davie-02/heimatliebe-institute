/**
 * The workspace map: every area (module), its pages and the access each page needs. It drives the
 * sidebar, the module home pages and which links a person sees — so adding a page is one line here
 * plus its route in pages/admin/WorkspaceRoutes.tsx.
 */
import type { IconName } from "@/components/Icon";
import type { Level, ModuleKey } from "@/lib/types";

export interface PageLink {
  to: string;
  label: string;
  icon: IconName;
  level?: Level;
  description?: string;
  systemAdminOnly?: boolean;
}

export interface ModuleNav {
  key: ModuleKey;
  label: string;
  icon: IconName;
  pages: PageLink[];
}

const r = (resource: string, label: string, icon: IconName, description?: string): PageLink => ({ to: `/admin/r/${resource}`, label, icon, description });

export const MODULE_NAV: ModuleNav[] = [
  {
    key: "admissions",
    label: "Admissions",
    icon: "user-plus",
    pages: [
      r("applications", "Applications", "file-text", "Review and accept online applications"),
      r("enquiries", "Enquiries", "inbox", "Walk-ins, calls, WhatsApp and website questions"),
      r("placement-results", "Placement tests", "target", "Results of the online placement test"),
      r("exam-registrations", "Exam registrations", "award", "Candidates for official exams"),
    ],
  },
  {
    key: "students",
    label: "Students",
    icon: "users",
    pages: [
      r("students", "Students", "users", "Every learner and their records"),
      r("enrollments", "Enrolments", "user-check", "Who is in which class"),
      r("certificates", "Certificates", "award", "Issue and revoke certificates"),
      r("skill-assessments", "Skills reports", "trending-up", "Reading, writing, listening and speaking"),
      r("alumni", "Alumni", "graduation", "Former students and their stories"),
    ],
  },
  {
    key: "teaching",
    label: "My teaching",
    icon: "school",
    pages: [{ to: "/admin/teaching", label: "My classes", icon: "school", description: "Registers, assignments, exams and marks" }],
  },
  {
    key: "academics",
    label: "Academics",
    icon: "book",
    pages: [
      r("courses", "Courses", "book", "Courses on the website"),
      r("classes", "Classes", "users", "Groups, teachers, rooms and dates"),
      r("timetable", "Timetable", "clock", "Weekly lesson times"),
      r("assignments", "Assignments", "edit", "Across all classes"),
      r("exams", "Exams & quizzes", "check-square", "Across all classes"),
      r("exam-sessions", "Official exam dates", "award", "Sessions candidates can register for"),
      r("calendar", "Calendar", "calendar", "Terms, holidays and events"),
      r("evaluations", "Course feedback", "star", "What students say"),
    ],
  },
  {
    key: "finance",
    label: "Finance",
    icon: "wallet",
    pages: [
      { to: "/admin/finance", label: "Overview", icon: "bar-chart", description: "Money in, balances and debtors" },
      { to: "/admin/finance/payments", label: "Payments to check", icon: "check-circle", description: "Confirm payments students reported" },
      { to: "/admin/finance/bulk", label: "Invoice a class", icon: "layers", level: "edit", description: "Raise the same invoice for a whole class" },
      r("invoices", "Invoices", "file-text", "Every invoice"),
      r("payments", "All payments", "credit-card", "Every payment and receipt"),
      r("fees", "Fee structure", "tag", "Standard fees per course"),
      r("scholarships", "Scholarships", "gift", "Open scholarships"),
      r("scholarship-applications", "Scholarship applications", "clipboard", "Decide applications"),
    ],
  },
  {
    key: "communication",
    label: "Communication",
    icon: "megaphone",
    pages: [r("announcements", "Announcements", "megaphone", "Notices for students, staff or the public")],
  },
  {
    key: "website",
    label: "Website",
    icon: "globe",
    pages: [
      { to: "/admin/website", label: "Homepage & contact", icon: "home", level: "view", description: "Headline, about text, goals, contact details" },
      r("news", "News", "file-text", "Articles and announcements"),
      r("gallery", "Gallery", "image", "Photos"),
      r("documents", "Downloads", "download", "Brochures and forms"),
      r("testimonials", "Testimonials", "message-circle", "What students say"),
      r("faq", "FAQ", "info", "Questions and answers"),
      r("library", "Library", "book-open", "Books, audio and worksheets"),
    ],
  },
  {
    key: "assistant",
    label: "Website assistant",
    icon: "message-circle",
    pages: [
      { to: "/admin/assistant", label: "Overview & suggestions", icon: "message-circle", description: "Questions visitors asked, drafted FAQ answers" },
      r("knowledge", "What it knows", "book", "Extra facts for the assistant"),
    ],
  },
  { key: "insights", label: "Reports", icon: "bar-chart", pages: [{ to: "/admin/reports", label: "Reports", icon: "bar-chart", description: "Trends across the institute" }] },
  {
    key: "hr",
    label: "People (HR)",
    icon: "briefcase",
    pages: [
      { to: "/admin/staff", label: "Staff", icon: "users", description: "Staff accounts and invitations" },
      { to: "/admin/leave", label: "Leave requests", icon: "umbrella", description: "Approve or decline leave" },
    ],
  },
  {
    key: "system",
    label: "System",
    icon: "settings",
    pages: [
      { to: "/admin/staff", label: "Staff & access", icon: "shield", description: "Who can do what" },
      { to: "/admin/settings", label: "Institute settings", icon: "settings", description: "Currency, pass mark, fees, payment details" },
      r("apps", "Apps & links", "grid", "Google Workspace, Moodle and other tools"),
      r("webhooks", "Webhooks", "link", "Notify other systems"),
      { to: "/admin/guides", label: "Guides", icon: "book-open", description: "Help pages for each area" },
      { to: "/admin/system", label: "System status", icon: "activity", description: "Email, storage, sign-in and live updates" },
    ],
  },
];

export const WORKSPACE_LINKS: PageLink[] = [
  { to: "/admin", label: "Home", icon: "home" },
  { to: "/admin/messages", label: "Messages", icon: "message-square" },
  { to: "/admin/me", label: "My work & leave", icon: "user" },
  { to: "/admin/directory", label: "Team directory", icon: "users" },
  { to: "/admin/activity", label: "Activity & undo", icon: "refresh" },
  { to: "/admin/security", label: "My security", icon: "lock" },
];
