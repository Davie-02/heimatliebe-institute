/**
 * Online exams: the question format, automatic marking and what students may see.
 *
 * A question:
 *   { id, type, prompt, options?, answer?, points }
 *   type "choice"    – one correct option; answer = index of the option
 *   type "multi"     – several correct options; answer = list of indexes (all must be chosen, nothing extra)
 *   type "truefalse" – answer = true | false
 *   type "short"     – a word or phrase; answer = accepted answers separated by "|" (case, extra spaces and end punctuation ignored)
 *   type "essay"     – marked by the teacher
 */

export type QuestionType = "choice" | "multi" | "truefalse" | "short" | "essay";

export interface Question {
  id: string;
  type: QuestionType;
  prompt: string;
  options?: string[];
  answer?: number | number[] | boolean | string;
  points: number;
}

export interface GradeResult {
  score: number;
  total: number;
  percentage: number;
  needsReview: boolean;
  /** Points earned per question id (null = waiting for the teacher). */
  marks: Record<string, number | null>;
}

const TYPES: QuestionType[] = ["choice", "multi", "truefalse", "short", "essay"];

/** Checks a paper from the exam builder and returns it cleaned, or a list of problems. */
export function validateQuestions(input: unknown): { questions: Question[]; problems: string[] } {
  const problems: string[] = [];
  if (!Array.isArray(input)) return { questions: [], problems: ["The questions must be a list."] };
  if (input.length > 200) problems.push("Keep a paper to 200 questions or fewer.");
  const seen = new Set<string>();
  const questions = input.slice(0, 200).map((raw, index): Question => {
    const q = (raw ?? {}) as Record<string, unknown>;
    const n = index + 1;
    const id = typeof q.id === "string" && q.id.trim() ? q.id.trim().slice(0, 40) : `q${n}`;
    if (seen.has(id)) problems.push(`Question ${n} has the same id as another question.`);
    seen.add(id);
    const type = TYPES.includes(q.type as QuestionType) ? (q.type as QuestionType) : "choice";
    const prompt = typeof q.prompt === "string" ? q.prompt.trim().slice(0, 4000) : "";
    if (!prompt) problems.push(`Question ${n} needs a question text.`);
    const points = Number(q.points ?? 1);
    if (!Number.isFinite(points) || points <= 0 || points > 1000) problems.push(`Question ${n} needs a positive number of points.`);
    const options = Array.isArray(q.options) ? q.options.map((o) => String(o ?? "").trim().slice(0, 500)).filter(Boolean) : undefined;

    let answer: Question["answer"];
    if (type === "choice") {
      if (!options || options.length < 2) problems.push(`Question ${n} needs at least two options.`);
      answer = Number(q.answer);
      if (!Number.isInteger(answer) || !options || answer < 0 || answer >= options.length) problems.push(`Question ${n}: mark which option is correct.`);
    } else if (type === "multi") {
      if (!options || options.length < 2) problems.push(`Question ${n} needs at least two options.`);
      const list = Array.isArray(q.answer) ? [...new Set(q.answer.map(Number))].sort((a, b) => a - b) : [];
      if (!list.length || list.some((i) => !Number.isInteger(i) || !options || i < 0 || i >= options.length)) problems.push(`Question ${n}: tick the correct options.`);
      answer = list;
    } else if (type === "truefalse") {
      answer = q.answer === true || q.answer === "true";
    } else if (type === "short") {
      answer = typeof q.answer === "string" ? q.answer.trim().slice(0, 500) : "";
      if (!answer) problems.push(`Question ${n}: enter the accepted answer(s).`);
    }
    return { id, type, prompt, ...(options && (type === "choice" || type === "multi") ? { options } : {}), ...(answer !== undefined ? { answer } : {}), points: Number.isFinite(points) && points > 0 ? points : 1 };
  });
  return { questions, problems };
}

/** The paper as a student sees it: no answers. */
export function studentPaper(questions: Question[]) {
  return questions.map(({ answer: _answer, ...rest }) => rest);
}

export function normalizeText(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s.,;:!?"'„“”«»()-]+|[\s.,;:!?"'„“”«»()-]+$/g, "")
    .trim();
}

function autoMark(question: Question, given: unknown): number | null {
  switch (question.type) {
    case "choice":
      return Number(given) === question.answer ? question.points : 0;
    case "multi": {
      const chosen = Array.isArray(given) ? [...new Set(given.map(Number))].sort((a, b) => a - b) : [];
      return JSON.stringify(chosen) === JSON.stringify(question.answer) ? question.points : 0;
    }
    case "truefalse":
      return (given === true || given === "true") === question.answer ? question.points : 0;
    case "short": {
      if (typeof given !== "string" || !given.trim()) return 0;
      const accepted = String(question.answer ?? "").split("|").map(normalizeText).filter(Boolean);
      return accepted.includes(normalizeText(given)) ? question.points : 0;
    }
    default:
      return null;
  }
}

/**
 * Marks a submission. Essay questions (and any question the teacher has marked by hand in
 * `manual`) use the teacher's mark; until every essay has one, the attempt "needs review".
 */
export function grade(questions: Question[], answers: Record<string, unknown>, manual: Record<string, number> = {}, passMark = 50): GradeResult & { passed: boolean | null } {
  const marks: Record<string, number | null> = {};
  let score = 0;
  let total = 0;
  let needsReview = false;
  for (const question of questions) {
    total += question.points;
    const teacher = manual[question.id];
    const mark = teacher !== undefined && Number.isFinite(teacher) ? Math.max(0, Math.min(question.points, teacher)) : autoMark(question, answers[question.id]);
    marks[question.id] = mark;
    if (mark === null) needsReview = true;
    else score += mark;
  }
  const percentage = total ? Math.round((score / total) * 1000) / 10 : 0;
  return { score, total, percentage, needsReview, marks, passed: needsReview ? null : percentage >= passMark };
}
