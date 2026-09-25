/**
 * Small text helpers for the assistant: removing personal details before questions are stored,
 * and comparing questions so repeated ones can be matched to the FAQ and grouped.
 */

const STOP_WORDS = new Set(
  "a an the is are was be to of in on for at by and or do does can i you we my your it this that what how when where which who with from about me please hi hello there ist der die das ein eine und ich wie was wo".split(" ")
);

/** Replaces email addresses and phone numbers with placeholders. */
export function scrubPersonalDetails(text: string): string {
  return text
    .replace(/[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}/gi, "[email]")
    .replace(/(\+?\d[\d\s().-]{6,}\d)/g, "[phone]");
}

export function normalizeQuestion(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ß ]+/g, " ").replace(/\s+/g, " ").trim();
}

export function keywords(text: string): Set<string> {
  return new Set(normalizeQuestion(text).split(" ").filter((w) => w.length > 2 && !STOP_WORDS.has(w)).map((w) => w.replace(/(ies|es|s)$/, "")));
}

/** How alike two questions are, from 0 (nothing shared) to 1 (same keywords). */
export function similarity(a: string, b: string): number {
  const ka = keywords(a);
  const kb = keywords(b);
  if (!ka.size || !kb.size) return 0;
  let shared = 0;
  for (const word of ka) if (kb.has(word)) shared++;
  return shared / (ka.size + kb.size - shared);
}

/** Groups similar questions; returns the groups, largest first. */
export function clusterQuestions(questions: string[], threshold = 0.5): string[][] {
  const clusters: string[][] = [];
  for (const q of questions) {
    const home = clusters.find((c) => similarity(c[0], q) >= threshold);
    if (home) home.push(q);
    else clusters.push([q]);
  }
  return clusters.sort((a, b) => b.length - a.length);
}
