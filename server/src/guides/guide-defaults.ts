/**
 * Built-in "How do I…?" help for each workspace area. A system administrator can rewrite any of
 * them under System → Guides; the edited text is stored and replaces the default.
 * Text uses simple formatting: blank lines between paragraphs, "- " for list items.
 */
export interface GuideDefault {
  key: string;
  module: string;
  title: string;
  body: string;
}

export const GUIDE_DEFAULTS: GuideDefault[] = [
  {
    key: "getting-started",
    module: "workspace",
    title: "Getting started in the workspace",
    body: `The menu on the left only shows the areas you can use. If something you need is missing, ask the system administrator to extend your access.

- Home shows what needs your attention today.
- The bell shows notifications; Messages are private conversations with colleagues and students.
- Everything you change is recorded under Activity & undo, where you can undo a mistake.
- My security is where you change your password and turn on two-step verification.`,
  },
  {
    key: "admissions-applications",
    module: "admissions",
    title: "Handling a new application",
    body: `1. Open Admissions → Applications and choose the application.
2. Check the details, the placement test result and any payment proof.
3. Mark it as Reviewing while you follow up, or Waitlisted / Not accepted with a short message.
4. Choose Accept to finish: pick the class, add the first invoice if needed, and the student receives an email to open their portal.

Accepting creates the student number automatically. If the person studied with us before, their existing student record is reused.`,
  },
  {
    key: "admissions-enquiries",
    module: "admissions",
    title: "Keeping track of enquiries",
    body: `Record every walk-in, call and WhatsApp question under Enquiries, not only website messages.

- Set Handled by so everyone knows who is following up.
- Set a Next follow-up date; the Home page lists enquiries that are due.
- Change the status to Converted once they apply, or Closed if they're not interested.`,
  },
  {
    key: "teaching-register",
    module: "teaching",
    title: "Taking the register",
    body: `Open My teaching, choose the class and select Register. Everyone starts as Present; tap a name to change it to Late, Absent or Excused, then Save.

You can correct a register later by choosing the date again. Tick "Tell absent students" to send them a notification.`,
  },
  {
    key: "teaching-exams",
    module: "teaching",
    title: "Creating an online exam",
    body: `In a class, open Exams → New exam and add questions:

- Single choice, multiple choice and true/false are marked automatically.
- Short answer is marked automatically when the typed answer matches one of the accepted answers (separate several with |).
- Essay questions are marked by you under Marking.

Set when it opens and closes and how many minutes students get, then switch on "Open to students". Answers are saved as students go, so a dropped connection doesn't lose work.`,
  },
  {
    key: "finance-payments",
    module: "finance",
    title: "Confirming payments",
    body: `Students report payments in their portal with a photo of the confirmation. They appear under Finance → Payments as Pending.

1. Check the amount and reference against the bank or mobile money statement.
2. Choose Confirm: the invoice is updated, a receipt number is issued and the student is told.
3. If it can't be matched, choose Not accepted and say why.

Money received at the office is recorded with Record payment, which confirms it immediately.`,
  },
  {
    key: "finance-invoicing",
    module: "finance",
    title: "Invoicing a whole class",
    body: `Use Finance → Bulk invoice, choose the class, the description (for example "Term 2 tuition") and the amount. Students who already have an invoice with the same description are skipped, so it is safe to run twice.

Invoices become Overdue automatically the day after their due date, and students with a balance get a polite reminder email each Monday.`,
  },
  {
    key: "website-content",
    module: "website",
    title: "Changing the website",
    body: `Website → Homepage & contact holds the headline, about text, goals, languages and contact details. Courses, News, Gallery, Downloads, Testimonials, FAQ and Library each have their own list.

Changes appear on the website within a second for everyone who has it open. Untick "Show on website" to hide something without deleting it.`,
  },
  {
    key: "assistant",
    module: "assistant",
    title: "Teaching the website assistant",
    body: `The assistant answers visitors' questions using the courses, fees, FAQ, exam dates, contact details and the notes under Assistant knowledge. It never makes up prices or dates.

- Add a knowledge note for anything it should know that isn't on the website (directions, payment details, office rules).
- Questions it couldn't answer are grouped under Suggested FAQ with a drafted answer. Edit and publish the good ones to the FAQ.`,
  },
  {
    key: "staff-access",
    module: "system",
    title: "Giving staff the right access",
    body: `Each person's access comes from their department, with four levels per area: None, View, Edit and Manage.

- Invite staff under People (HR) or System → Staff & access. They receive a one-time password and choose their own at first sign-in.
- To give one person more or less than their department, set an override for that area.
- Changing access, adding administrators or resetting someone's two-step verification asks you to confirm it's you first.

System administrators sign in at /admin/login and must use two-step verification.`,
  },
  {
    key: "undo",
    module: "workspace",
    title: "Undoing a mistake",
    body: `Open Activity & undo. Find the change and choose Undo. Edits, additions and most deletions can be undone.

An undo is refused if someone has changed the same record since — so nobody's later work is overwritten. Deleting something that removes other records with it (a class with its registers) can't be undone; the app warns you before such a delete.`,
  },
];
