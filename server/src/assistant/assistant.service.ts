import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { EventsService } from "../events/events.service";
import { SiteContentService } from "../site/site-content.service";
import { ActivityService, type Actor } from "../activity/activity.service";
import { AssistantUnavailableError, GeminiClient, type ChatTurn } from "./gemini.client";
import { clusterQuestions, normalizeQuestion, scrubPersonalDetails, similarity } from "./text";

/** Added by the model to answers it couldn't give from the facts; removed before the visitor sees it. */
const UNSURE = "[[UNSURE]]";
const KNOWLEDGE_CACHE_MS = 60_000;
const ANSWER_CACHE_MS = 10 * 60_000;
/** An FAQ entry this close to the question is answered directly, without asking the model. */
const DIRECT_MATCH = 0.6;

/**
 * The website assistant. It answers visitors' questions ONLY from the institute's own
 * information — courses, fees, exam dates, FAQ, contact details and the knowledge notes staff
 * write — and says so when it doesn't know, pointing to the office instead of guessing.
 *
 * Questions (with emails and phone numbers removed) are kept for 90 days. Every night, questions
 * asked repeatedly that the FAQ doesn't cover are grouped, and a draft FAQ entry is written for
 * staff to check and publish — so the FAQ grows from what people really ask.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private knowledgeCache: { text: string; faq: Array<{ question: string; answer: string }>; until: number } | null = null;
  private readonly answerCache = new Map<string, { answer: string; until: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly content: SiteContentService,
    private readonly activity: ActivityService,
    private readonly gemini: GeminiClient
  ) {
    this.events.onWrite(() => {
      this.knowledgeCache = null;
      this.answerCache.clear();
    });
  }

  async status() {
    const institution = await this.content.get("institution");
    return {
      enabled: this.gemini.configured && (process.env.ASSISTANT_ENABLED ?? "true") !== "false",
      name: process.env.ASSISTANT_NAME || "Ask Heimatliebe",
      greeting: `Hello! Ask me about courses, fees, placement tests or exams at ${institution.name}.`,
    };
  }

  /** Everything the assistant may use, as plain text. */
  async knowledge(): Promise<{ text: string; faq: Array<{ question: string; answer: string }> }> {
    if (this.knowledgeCache && this.knowledgeCache.until > Date.now()) return this.knowledgeCache;
    const today = new Date(new Date().toISOString().slice(0, 10));
    const [{ institution, site }, courses, sessions, faq, notes, events, announcements] = await Promise.all([
      this.content.all(),
      this.prisma.course.findMany({ where: { published: true }, orderBy: { position: "asc" }, take: 60 }),
      this.prisma.examSession.findMany({ where: { published: true, examDate: { gte: today } }, orderBy: { examDate: "asc" }, take: 20 }),
      this.prisma.faq.findMany({ where: { published: true }, orderBy: { position: "asc" }, take: 150 }),
      this.prisma.knowledgeNote.findMany({ where: { active: true }, orderBy: { updatedAt: "desc" }, take: 60 }),
      this.prisma.calendarEvent.findMany({ where: { public: true, startDate: { gte: today } }, orderBy: { startDate: "asc" }, take: 20 }),
      this.prisma.announcement.findMany({ where: { published: true, audience: "public" }, orderBy: { createdAt: "desc" }, take: 5 }),
    ]);
    const inst = institution as Record<string, unknown>;
    const s = site as Record<string, unknown>;
    const lines: string[] = [];
    lines.push(`# About\n${inst.name} — ${inst.tagline}, ${inst.location}.`, String(s.aboutBody ?? ""));
    lines.push(`# Contact\nAddress: ${s.contactAddress}\nPhone: ${s.contactPhone}\nEmail: ${s.contactEmail}\nWhatsApp: +${inst.whatsappNumber}\nOffice hours:\n${s.officeHours}`);
    lines.push(`# Enrolment\nApplications are ${inst.enrolmentOpen ? "open" : "closed at the moment"}. Apply online on the website (Apply page). A free online placement test recommends a starting level. Application fee: ${Number(inst.applicationFee) ? `${inst.currency} ${inst.applicationFee}` : "none"}.\nPayment: ${inst.paymentInstructions}`);
    lines.push(
      "# Courses\n" +
        (courses.length
          ? courses.map((c) => `- ${c.title} (${c.language}${c.level ? `, ${c.level}` : ""}) — ${c.status}. ${c.schedule ? `Schedule: ${c.schedule}. ` : ""}${c.duration ? `Duration: ${c.duration}. ` : ""}${c.feeText ? `Fee: ${c.feeText}. ` : c.feeAmount ? `Fee: ${inst.currency} ${Number(c.feeAmount)}. ` : ""}${c.summary ?? ""}`).join("\n")
          : "No courses are listed right now.")
    );
    if (sessions.length) {
      lines.push("# Official exam dates\n" + sessions.map((e) => `- ${e.title} (${e.provider}${e.level ? `, ${e.level}` : ""}) on ${e.examDate.toISOString().slice(0, 10)}${e.registrationDeadline ? `, register by ${e.registrationDeadline.toISOString().slice(0, 10)}` : ""}${e.fee ? `, fee ${inst.currency} ${Number(e.fee)}` : ""}${e.venue ? `, at ${e.venue}` : ""}. Register on the Exams page.`).join("\n"));
    }
    if (events.length) lines.push("# Calendar\n" + events.map((e) => `- ${e.startDate.toISOString().slice(0, 10)}${e.endDate ? ` to ${e.endDate.toISOString().slice(0, 10)}` : ""}: ${e.title}`).join("\n"));
    if (announcements.length) lines.push("# News\n" + announcements.map((a) => `- ${a.title}: ${(a.body ?? "").slice(0, 300)}`).join("\n"));
    if (notes.length) lines.push("# More information\n" + notes.map((n) => `## ${n.title}\n${n.body}`).join("\n"));
    if (faq.length) lines.push("# Frequently asked questions\n" + faq.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n"));

    this.knowledgeCache = { text: lines.join("\n\n").slice(0, 60_000), faq: faq.map((f) => ({ question: f.question, answer: f.answer })), until: Date.now() + KNOWLEDGE_CACHE_MS };
    return this.knowledgeCache;
  }

  private async systemPrompt(): Promise<string> {
    const { text } = await this.knowledge();
    const institution = await this.content.get("institution");
    return `You are the friendly website assistant of ${institution.name}, a language school in ${institution.location}.
Answer visitors' questions using ONLY the facts below. Keep answers short (at most 5 sentences or a short list), warm and practical.
Reply in the same language the visitor writes in.
Never invent prices, dates, schedules, names or promises. If the facts don't contain the answer, say you're not sure, suggest contacting the office (phone, email or WhatsApp from the facts), and end your reply with ${UNSURE}.
Don't ask for or repeat personal details. Don't answer questions unrelated to the institute, languages or studying; politely steer back.
Use plain text (no Markdown headings). Today is ${new Date().toISOString().slice(0, 10)}.

FACTS
${text}`;
  }

  async chat(message: string, history: ChatTurn[] = []): Promise<{ answer: string; answered: boolean }> {
    const question = message.trim();
    if (!question) throw new BadRequestException("Type a question first.");
    if (question.length > 600) throw new BadRequestException("Please keep your question shorter.");
    const status = await this.status();
    if (!status.enabled) throw new NotFoundException("The assistant is not available.");

    const key = normalizeQuestion(question);
    const cached = history.length === 0 ? this.answerCache.get(key) : undefined;
    if (cached && cached.until > Date.now()) return { answer: cached.answer, answered: true };

    // A close FAQ match is answered straight from the FAQ: instant, and no model quota used.
    if (history.length === 0) {
      const { faq } = await this.knowledge();
      const best = faq.map((f) => ({ f, score: similarity(f.question, question) })).sort((a, b) => b.score - a.score)[0];
      if (best && best.score >= DIRECT_MATCH) {
        await this.record(question, best.f.answer, true, "direct");
        return { answer: best.f.answer, answered: true };
      }
    }

    const turns: ChatTurn[] = [...history.slice(-6).map((t) => ({ role: t.role, text: t.text.slice(0, 1500) })), { role: "user", text: question }];
    try {
      const { text } = await this.gemini.generate(await this.systemPrompt(), turns, { maxOutputTokens: 500 });
      const answered = !text.includes(UNSURE);
      const answer = text.replace(UNSURE, "").trim();
      if (answered && history.length === 0) this.answerCache.set(key, { answer, until: Date.now() + ANSWER_CACHE_MS });
      await this.record(question, answer, answered, "model");
      return { answer, answered };
    } catch (error) {
      if (!(error instanceof AssistantUnavailableError)) this.logger.error("Assistant error", error as Error);
      const site = (await this.content.get("site")) as Record<string, unknown>;
      const answer = `Sorry, I can't answer right now. Please contact the office on ${site.contactPhone} or ${site.contactEmail}.`;
      await this.record(question, null, false, "fallback");
      return { answer, answered: false };
    }
  }

  private async record(question: string, answer: string | null, answered: boolean, source: string) {
    await this.prisma.assistantLog
      .create({ data: { question: scrubPersonalDetails(question).slice(0, 600), answer: answer?.slice(0, 3000) ?? null, answered, source } })
      .catch(() => undefined);
  }

  // ── Staff side ──────────────────────────────────────────────────────────────

  async logs(query: { unanswered?: boolean; take?: number }) {
    return this.prisma.assistantLog.findMany({ where: query.unanswered ? { answered: false } : {}, orderBy: { createdAt: "desc" }, take: Math.min(query.take ?? 100, 300) });
  }

  async stats() {
    const since = new Date(Date.now() - 30 * 86400_000);
    const [total, unanswered, direct, drafts] = await Promise.all([
      this.prisma.assistantLog.count({ where: { createdAt: { gte: since } } }),
      this.prisma.assistantLog.count({ where: { createdAt: { gte: since }, answered: false } }),
      this.prisma.assistantLog.count({ where: { createdAt: { gte: since }, source: "direct" } }),
      this.prisma.faqSuggestion.count({ where: { status: "draft" } }),
    ]);
    return { ...(await this.status()), models: this.gemini.models, last30Days: { total, unanswered, direct }, drafts };
  }

  suggestions(status = "draft") {
    return this.prisma.faqSuggestion.findMany({ where: { status }, orderBy: [{ asked: "desc" }, { updatedAt: "desc" }], take: 100 });
  }

  /**
   * Groups the last 30 days' questions that the FAQ doesn't already cover and drafts an FAQ entry
   * for each group asked at least twice. Drafts are never published without a person.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async refreshSuggestions(): Promise<{ created: number }> {
    if (process.env.RUN_SCHEDULER === "false" && !this.refreshing) return { created: 0 };
    const since = new Date(Date.now() - 30 * 86400_000);
    const [logs, faq, existing] = await Promise.all([
      this.prisma.assistantLog.findMany({ where: { createdAt: { gte: since }, source: { not: "direct" } }, select: { question: true }, take: 2000 }),
      this.prisma.faq.findMany({ select: { question: true } }),
      this.prisma.faqSuggestion.findMany({ select: { id: true, question: true, status: true } }),
    ]);
    const uncovered = logs.map((l) => l.question).filter((q) => !faq.some((f) => similarity(f.question, q) >= DIRECT_MATCH));
    let created = 0;
    for (const group of clusterQuestions(uncovered).filter((g) => g.length >= 2).slice(0, 10)) {
      const known = existing.find((s) => similarity(s.question, group[0]) >= DIRECT_MATCH);
      if (known) {
        await this.prisma.faqSuggestion.update({ where: { id: known.id }, data: { asked: group.length } });
        continue;
      }
      let answer = "";
      if (this.gemini.configured) {
        try {
          const { text } = await this.gemini.generate(
            `${await this.systemPrompt()}\n\nWrite a clear FAQ answer (2–4 sentences) to the question below for the website FAQ. If the facts don't contain the answer, reply exactly ${UNSURE}.`,
            [{ role: "user", text: group[0] }],
            { maxOutputTokens: 300, timeoutMs: 30_000 }
          );
          answer = text.includes(UNSURE) ? "" : text.trim();
        } catch {
          answer = "";
        }
      }
      await this.prisma.faqSuggestion.create({ data: { question: group[0].slice(0, 300), answer, asked: group.length } });
      created++;
    }
    if (created) this.events.emit(["faq-suggestions"]);
    return { created };
  }

  private refreshing = false;

  /** "Check for new suggestions now" button. */
  async refreshNow() {
    this.refreshing = true;
    try {
      return await this.refreshSuggestions();
    } finally {
      this.refreshing = false;
    }
  }

  async publishSuggestion(id: string, input: { question: string; answer: string; category?: string }, actor: Actor & { id: string; name: string }) {
    const suggestion = await this.prisma.faqSuggestion.findUnique({ where: { id } });
    if (!suggestion) throw new NotFoundException("Suggestion not found.");
    if (!input.answer.trim()) throw new BadRequestException("Write the answer before publishing.");
    const position = (await this.prisma.faq.count()) + 1;
    const faq = await this.prisma.faq.create({ data: { question: input.question.trim(), answer: input.answer.trim(), category: input.category?.trim() || null, position } });
    await this.prisma.faqSuggestion.update({ where: { id }, data: { status: "published", question: faq.question, answer: faq.answer } });
    await this.activity.log(actor, "published", `Added “${faq.question}” to the FAQ`, { type: "faq", id: faq.id }, { kind: "created", model: "faq", id: faq.id, topic: "faq" });
    this.events.emit(["faq", "faq-suggestions"]);
    this.events.noteWrite();
    return faq;
  }

  async dismissSuggestion(id: string) {
    await this.prisma.faqSuggestion.update({ where: { id }, data: { status: "dismissed" } });
    this.events.emit(["faq-suggestions"]);
    return { dismissed: true };
  }

  /** Forget old questions: they are only useful for spotting trends. */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeOldLogs() {
    await this.prisma.assistantLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 90 * 86400_000) } } }).catch(() => undefined);
  }
}
