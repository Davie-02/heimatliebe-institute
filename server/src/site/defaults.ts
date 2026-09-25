/**
 * Default website text and institute settings. Admins change them under Website → Homepage &
 * contact and System → Institute settings; what they save is stored in the SiteContent table and
 * merged over these defaults, so a new setting added here appears everywhere with a sensible value.
 */

export const INSTITUTION_DEFAULTS = {
  name: "Heimatliebe Institute",
  shortName: "Heimatliebe",
  tagline: "Private International Language School",
  location: "Karonga, Malawi",
  currency: "MWK",
  currentTerm: "Term 1",
  academicYear: String(new Date().getFullYear()),
  passMark: 50,
  attendanceAlertThreshold: 75,
  applicationFee: 0,
  enrolmentOpen: true,
  languages: ["German", "French", "Swahili", "Spanish", "Chinese", "Latin", "English"],
  levels: ["A1", "A2", "B1", "B2", "C1", "C2"],
  paymentInstructions:
    "Pay by Airtel Money, TNM Mpamba or bank transfer and upload a photo of the confirmation in your portal. Use your student number as the reference.",
  whatsappNumber: "265991383466",
};

export const SITE_DEFAULTS = {
  heroWords: ["Welcome to", "Heimatliebe", "Institute", "Language", "Connects!"],
  heroLabel: "German · A1 – B2 · Karonga, Malawi",
  heroTagline: "Empowering Malawians with foreign language skills that open doors to education, employment, and the world.",
  heroImage: "",
  aboutTitle: "Language education rooted in Malawi, reaching the world.",
  aboutBody:
    "Heimatliebe Institute is a private international language school based in Karonga, in the Northern Region of Malawi. We exist to deliver high-quality foreign language education that is accessible, practical, and career-defining.\n\nOur name reflects our belief: that a love of one's homeland and the drive to connect with the wider world are not opposites — they strengthen each other. We give Malawians the linguistic tools to engage confidently in education, travel, employment, and culture across borders.\n\nCurrently offering German at levels A1 through B2, we are building toward becoming a comprehensive multilingual centre and a certified language examination hub — so that Malawians no longer need to travel abroad to sit for internationally recognised language qualifications.",
  stats: [
    { num: "A1–B2", label: "German levels currently offered" },
    { num: "6", label: "Languages in the expansion plan" },
    { num: "7", label: "Core programme goals" },
  ],
  goalsTitle: "Seven goals that drive our programme.",
  goalsIntro: "Every course we design, every student we enrol, and every partnership we build is guided by these commitments.",
  goals: [
    { icon: "graduation", title: "Study Abroad Support", text: "We prepare students with the language proficiency needed to gain admission to — and succeed in — academic programmes in German-speaking countries and beyond." },
    { icon: "briefcase", title: "Workforce Preparation", text: "For those planning to work abroad, our courses build real workplace communication skills, improving job prospects and supporting Malawi's economy through remittances." },
    { icon: "plane", title: "Travel Confidence", text: "We equip travellers with practical language knowledge and cultural context so they can navigate new environments with ease and confidence." },
    { icon: "globe", title: "Tourism Growth", text: "Graduates can serve as interpreters or certified tour guides, contributing directly to Malawi's growing tourism sector and the local economy." },
    { icon: "book", title: "Training of Trainers", text: "We actively support the development of future language teachers, strengthening Malawi's educational capacity in German, French, and other foreign languages." },
    { icon: "sprout", title: "Youth Empowerment", text: "We promote multilingualism among young Malawians, widening their worldview and introducing them to career and educational pathways made possible through language." },
    { icon: "award", title: "Certified Exam Centre", text: "We are working toward becoming an accredited language examination centre in Malawi — so students can earn internationally recognised certificates without leaving the country." },
  ],
  languagesTitle: "Languages we teach — and those coming next.",
  languagesIntro: "We currently offer German from beginner to upper-intermediate level, with an ambitious expansion plan in motion.",
  languages: [
    { code: "DE", name: "German", desc: "A1 · A2 · B1 · B2", status: "Currently offered" },
    { code: "SW", name: "Swahili", desc: "East African regional language", status: "Coming soon" },
    { code: "FR", name: "French", desc: "International & regional reach", status: "Coming soon" },
    { code: "ES", name: "Spanish", desc: "Global language of opportunity", status: "Coming soon" },
    { code: "ZH", name: "Chinese", desc: "Mandarin — global importance", status: "Coming soon" },
    { code: "LA", name: "Latin", desc: "Classical & academic foundation", status: "Coming soon" },
  ],
  visionTitle: "A centre of excellence in language training for Malawi.",
  visionBody:
    "Heimatliebe Language Institute aspires to become the definitive hub for foreign language education in Malawi — where academic rigour meets cultural curiosity, and every student leaves with skills that genuinely change the direction of their life.\n\nWe believe that strong language education fosters cross-cultural connections, improves employability, and prepares Malawians to engage confidently with the global community.",
  visionQuote: "Strong language education fosters cross-cultural connections and prepares Malawians to engage confidently with the global community.",
  contactAddress: "Karonga, Northern Region, Malawi",
  contactPhone: "+265 991 383 466",
  contactEmail: "heimatliebemw@gmail.com",
  officeHours: "Mon–Fri: 8:00 AM – 5:00 PM\nSaturday: 9:00 AM – 1:00 PM",
  mapUrl: "",
  socialFacebook: "",
  socialInstagram: "",
  socialTiktok: "",
  socialYoutube: "",
  footerNote: "",
};

export const CONTENT_DEFAULTS = { institution: INSTITUTION_DEFAULTS, site: SITE_DEFAULTS } as const;
export type ContentKey = keyof typeof CONTENT_DEFAULTS;
