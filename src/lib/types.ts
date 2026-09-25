/** Shapes of the main records the API returns. */

export type Level = "none" | "view" | "edit" | "manage";
export type ModuleKey = "admissions" | "students" | "academics" | "teaching" | "finance" | "communication" | "website" | "assistant" | "insights" | "hr" | "system";
export type AccessMap = Record<ModuleKey, Level>;

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: "OWNER" | "MANAGER" | "EMPLOYEE";
  department: string;
  jobTitle: string | null;
  photoUrl: string | null;
  twoFactorEnabled: boolean;
  access: AccessMap;
  mustSetUpTwoFactor: boolean;
}

export interface StudentUser {
  id: string;
  studentNo: string;
  name: string;
  email: string;
  phone: string | null;
  course: string | null;
  level: string | null;
  status: string;
  photoUrl: string | null;
}

export type SignInResult =
  | { kind: "staff"; user: StaffUser; token: string; expiresAt: string }
  | { kind: "student"; user: StudentUser; token: string; expiresAt: string }
  | { kind: "two-factor"; challenge: string }
  | { kind: "password-change"; challenge: string; name: string };

export interface Institution {
  name: string;
  shortName: string;
  tagline: string;
  location: string;
  currency: string;
  currentTerm: string;
  academicYear: string;
  passMark: number;
  attendanceAlertThreshold: number;
  applicationFee: number;
  enrolmentOpen: boolean;
  languages: string[];
  levels: string[];
  paymentInstructions: string;
  whatsappNumber: string;
}

export interface SiteText {
  heroWords: string[];
  heroLabel: string;
  heroTagline: string;
  heroImage: string;
  aboutTitle: string;
  aboutBody: string;
  stats: Array<{ num: string; label: string }>;
  goalsTitle: string;
  goalsIntro: string;
  goals: Array<{ icon: string; title: string; text: string }>;
  languagesTitle: string;
  languagesIntro: string;
  languages: Array<{ code: string; name: string; desc: string; status: string }>;
  visionTitle: string;
  visionBody: string;
  visionQuote: string;
  contactAddress: string;
  contactPhone: string;
  contactEmail: string;
  officeHours: string;
  mapUrl: string;
  socialFacebook: string;
  socialInstagram: string;
  socialTiktok: string;
  socialYoutube: string;
  footerNote: string;
}

export interface Course {
  id: string;
  slug: string;
  title: string;
  language: string;
  level: string | null;
  status: string;
  schedule: string | null;
  duration: string | null;
  feeText: string | null;
  feeAmount: number | null;
  capacity: number | null;
  summary: string | null;
  body: string | null;
  image: string | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
