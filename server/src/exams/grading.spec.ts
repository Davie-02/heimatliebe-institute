import { grade, normalizeText, studentPaper, validateQuestions, type Question } from "./grading";

const paper: Question[] = [
  { id: "a", type: "choice", prompt: "Ich ___ Anna.", options: ["heiße", "heißt"], answer: 0, points: 2 },
  { id: "b", type: "multi", prompt: "Which are articles?", options: ["der", "und", "die"], answer: [0, 2], points: 2 },
  { id: "c", type: "truefalse", prompt: "Berlin is in Germany.", answer: true, points: 1 },
  { id: "d", type: "short", prompt: "Plural of Buch?", answer: "Bücher|die Bücher", points: 1 },
  { id: "e", type: "essay", prompt: "Describe your family.", points: 4 },
];

describe("grading", () => {
  it("marks automatic questions and waits for essays", () => {
    const result = grade(paper, { a: 0, b: [2, 0], c: "true", d: "  die bücher. " , e: "Meine Familie…" });
    expect(result.marks).toEqual({ a: 2, b: 2, c: 1, d: 1, e: null });
    expect(result.needsReview).toBe(true);
    expect(result.passed).toBeNull();
    expect(result.total).toBe(10);
  });

  it("uses the teacher's marks and decides pass or fail", () => {
    const result = grade(paper, { a: 1, b: [0], c: false, d: "Buch" }, { e: 3 }, 50);
    expect(result.score).toBe(3);
    expect(result.percentage).toBe(30);
    expect(result.passed).toBe(false);
    expect(result.needsReview).toBe(false);
  });

  it("caps manual marks at the question's points", () => {
    expect(grade(paper, {}, { e: 99 }).marks.e).toBe(4);
  });

  it("never shows answers to students", () => {
    for (const q of studentPaper(paper)) expect("answer" in q).toBe(false);
  });

  it("validates papers from the builder", () => {
    const { problems } = validateQuestions([{ type: "choice", prompt: "x", options: ["a"], answer: 3 }, { type: "short", prompt: "" }]);
    expect(problems.length).toBeGreaterThanOrEqual(3);
    expect(validateQuestions(paper).problems).toEqual([]);
  });

  it("normalizes typed answers", () => {
    expect(normalizeText("  „Die   Bücher!“ ")).toBe("die bücher");
  });
});
