import { Injectable, Logger } from "@nestjs/common";

/**
 * Talks to Google's Gemini API (free key from https://aistudio.google.com/apikey).
 *
 * The free tier has per-model quotas and the newest models are sometimes overloaded, so models
 * are tried in order (ASSISTANT_MODELS, fastest first). A model that fails rests for a while
 * ("cooldown") so it isn't retried on every question. If the current model is slow, the next
 * one is started as well after ASSISTANT_HEDGE_MS and the first answer wins ("racing"), which
 * removes most of the long waits visitors would otherwise see.
 */

export interface ChatTurn {
  role: "user" | "model";
  text: string;
}

export interface GenerateOptions {
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export class AssistantUnavailableError extends Error {}

const DEFAULT_MODELS = ["gemini-flash-lite-latest", "gemini-3.1-flash-lite", "gemini-3.6-flash"];
const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;
const ERROR_COOLDOWN_MS = 60_000;
const SLOW_COOLDOWN_MS = 20_000;

export function readModels(env: NodeJS.ProcessEnv = process.env): string[] {
  const list = (env.ASSISTANT_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_MODELS;
}

type FetchFn = typeof fetch;

@Injectable()
export class GeminiClient {
  private readonly logger = new Logger(GeminiClient.name);
  private readonly cooldownUntil = new Map<string, number>();
  /** Replaceable in tests. */
  fetchFn: FetchFn = (...args) => fetch(...args);
  now: () => number = () => Date.now();

  get configured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY?.trim());
  }

  get models(): string[] {
    return readModels();
  }

  /** Models not resting right now, in order. If all are resting, try them all anyway. */
  private available(): string[] {
    const ready = this.models.filter((m) => (this.cooldownUntil.get(m) ?? 0) <= this.now());
    return ready.length ? ready : this.models;
  }

  private rest(model: string, ms: number) {
    this.cooldownUntil.set(model, this.now() + ms);
  }

  private async callModel(model: string, system: string, turns: ChatTurn[], options: GenerateOptions, signal: AbortSignal): Promise<string> {
    const key = process.env.GEMINI_API_KEY!.trim();
    const response = await this.fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
        generationConfig: { maxOutputTokens: options.maxOutputTokens ?? 600, temperature: options.temperature ?? 0.3 },
      }),
      signal,
    });
    if (response.status === 429) {
      this.rest(model, RATE_LIMIT_COOLDOWN_MS);
      throw new Error(`${model}: quota reached`);
    }
    if (!response.ok) {
      this.rest(model, ERROR_COOLDOWN_MS);
      throw new Error(`${model}: HTTP ${response.status}`);
    }
    const body = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }> };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
    if (!text) throw new Error(`${model}: empty answer (${body.candidates?.[0]?.finishReason ?? "no candidates"})`);
    return text;
  }

  /** One answer from the first model that manages. Throws AssistantUnavailableError when none can. */
  async generate(system: string, turns: ChatTurn[], options: GenerateOptions = {}): Promise<{ text: string; model: string }> {
    if (!this.configured) throw new AssistantUnavailableError("GEMINI_API_KEY is not set.");
    const models = this.available();
    const timeoutMs = options.timeoutMs ?? 20_000;
    const hedgeMs = Number(process.env.ASSISTANT_HEDGE_MS ?? 2500);
    const controllers: AbortController[] = [];
    const errors: string[] = [];

    return new Promise((resolve, reject) => {
      let settled = false;
      let started = 0;
      let finished = 0;
      let hedgeTimer: NodeJS.Timeout | null = null;
      const overall = setTimeout(() => finish(new AssistantUnavailableError(`No answer within ${timeoutMs} ms`)), timeoutMs);

      const finish = (result: { text: string; model: string } | Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(overall);
        if (hedgeTimer) clearTimeout(hedgeTimer);
        controllers.forEach((c) => c.abort());
        if (result instanceof Error) reject(result);
        else resolve(result);
      };

      const startNext = () => {
        if (settled || started >= models.length) return;
        const model = models[started++];
        const controller = new AbortController();
        controllers.push(controller);
        const startedAt = this.now();
        this.callModel(model, system, turns, options, controller.signal)
          .then((text) => finish({ text, model }))
          .catch((error: unknown) => {
            if (settled) return;
            if ((error as Error)?.name === "AbortError" && this.now() - startedAt >= timeoutMs - 50) this.rest(model, SLOW_COOLDOWN_MS);
            errors.push(error instanceof Error ? error.message : String(error));
            finished++;
            if (started < models.length) startNext();
            else if (finished >= started) finish(new AssistantUnavailableError(errors.join("; ")));
          });
        if (hedgeMs > 0 && started < models.length) {
          if (hedgeTimer) clearTimeout(hedgeTimer);
          hedgeTimer = setTimeout(startNext, hedgeMs);
        }
      };
      startNext();
    }).catch((error: unknown) => {
      this.logger.warn(`Assistant unavailable: ${error instanceof Error ? error.message : error}`);
      throw error instanceof AssistantUnavailableError ? error : new AssistantUnavailableError(String(error));
    }) as Promise<{ text: string; model: string }>;
  }
}
