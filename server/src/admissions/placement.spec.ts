import { BANKS, optionOrder, placementLanguages, publicQuestions, scorePlacement } from "./placement";

/** Answers every question in the listed levels correctly (as the options are shown), the rest wrongly. */
function answer(language: string, rightLevels: string[]) {
  const answers: Record<string, number> = {};
  BANKS[language].forEach(([level, , options, right], n) => {
    const shown = optionOrder(language, n, options.length).indexOf(right);
    answers[String(n)] = rightLevels.includes(level) ? shown : (shown + 1) % options.length;
  });
  return answers;
}

describe("placement test", () => {
  it("offers the four languages", () => {
    expect(placementLanguages()).toEqual(["English", "French", "German", "Spanish"]);
  });

  it("shows every option exactly once, in a stable order", () => {
    const first = publicQuestions("German");
    expect(first).toEqual(publicQuestions("German"));
    first.forEach((q, n) => expect([...q.options].sort()).toEqual([...BANKS.German[n][2]].sort()));
  });

  it("recommends the level after the highest band passed without gaps", () => {
    expect(scorePlacement("German", answer("German", [])).recommendedLevel).toBe("A1");
    expect(scorePlacement("German", answer("German", ["A1"])).recommendedLevel).toBe("A2");
    expect(scorePlacement("German", answer("German", ["A1", "A2", "B1"])).recommendedLevel).toBe("B2");
    expect(scorePlacement("German", answer("German", ["A1", "B1", "B2"])).recommendedLevel).toBe("A2");
    const all = scorePlacement("French", answer("French", ["A1", "A2", "B1", "B2", "C1"]));
    expect(all.recommendedLevel).toBe("C2");
    expect(all.score).toBe(all.total);
  });

  it("ignores junk answers", () => {
    expect(scorePlacement("English", { "0": "x", "1": 99, foo: 1 }).score).toBe(0);
  });
});
