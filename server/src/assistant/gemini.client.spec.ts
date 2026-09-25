import { AssistantUnavailableError, GeminiClient } from "./gemini.client";

const ok = (text: string) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) }) as unknown as Response;
const fail = (status: number) => ({ ok: false, status, json: async () => ({}) }) as unknown as Response;

describe("GeminiClient", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.ASSISTANT_MODELS = "fast,backup";
    process.env.ASSISTANT_HEDGE_MS = "0";
  });

  it("falls back to the next model and rests the one that failed", async () => {
    const client = new GeminiClient();
    const calls: string[] = [];
    client.fetchFn = (async (url: string) => {
      calls.push(url.includes("/fast:") ? "fast" : "backup");
      return url.includes("/fast:") ? fail(429) : ok("Guten Tag");
    }) as unknown as typeof fetch;
    await expect(client.generate("sys", [{ role: "user", text: "hi" }])).resolves.toEqual({ text: "Guten Tag", model: "backup" });
    await client.generate("sys", [{ role: "user", text: "hi" }]);
    expect(calls).toEqual(["fast", "backup", "backup"]);
  });

  it("reports unavailability when every model fails", async () => {
    const client = new GeminiClient();
    client.fetchFn = (async () => fail(503)) as unknown as typeof fetch;
    await expect(client.generate("sys", [{ role: "user", text: "hi" }])).rejects.toBeInstanceOf(AssistantUnavailableError);
  });

  it("refuses to run without a key", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(new GeminiClient().generate("sys", [])).rejects.toBeInstanceOf(AssistantUnavailableError);
  });
});
