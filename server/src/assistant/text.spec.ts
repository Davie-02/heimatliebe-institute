import { clusterQuestions, scrubPersonalDetails, similarity } from "./text";

describe("assistant text helpers", () => {
  it("removes personal details", () => {
    expect(scrubPersonalDetails("Call me on +265 991 383 466 or mail ana@example.com")).toBe("Call me on [phone] or mail [email]");
  });

  it("recognises the same question worded differently", () => {
    expect(similarity("How much are the German A1 fees?", "What are the fees for German A1")).toBeGreaterThan(0.5);
    expect(similarity("How much are the fees?", "Where is the school?")).toBe(0);
  });

  it("groups repeated questions", () => {
    const groups = clusterQuestions(["When does the next German course start?", "when does next german course start", "Where are you located?"]);
    expect(groups[0]).toHaveLength(2);
    expect(groups).toHaveLength(2);
  });
});
