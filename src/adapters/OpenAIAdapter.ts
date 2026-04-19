import OpenAI from "openai";
import type { ILLMService, LLMJobInput, QuestionDraft } from "../ports/ILLMService";
import { normalizeQuestions } from "../domain/validation";

type TokenRecord = { timestamp: number; tokens: number };

type OpenAIAdapterOpts = {
  apiKey: string;
  model?: string;
};

/**
 * OpenAI adapter with a rolling 60s sliding-window token limiter.
 * Tier 1 TPM limit: 200k. We throttle at 180k to keep a safety buffer.
 */
export class OpenAIAdapter implements ILLMService {
  private readonly client: OpenAI;
  private readonly model: string;

  // CRITICAL: token bucket history (rolling 60s window)
  private tokenHistory: TokenRecord[] = [];

  constructor(opts: OpenAIAdapterOpts) {
    this.client = new OpenAI({ apiKey: opts.apiKey });
    this.model = opts.model ?? "gpt-4o-mini";
  }

  private estimateTokens(textChunk: string): number {
    return Math.ceil(String(textChunk ?? "").length / 4);
  }

  private async throttleForText(textChunk: string): Promise<void> {
    const estimatedTokens = this.estimateTokens(textChunk);

    // 1) Filter out records older than 60,000ms.
    const now = Date.now();
    this.tokenHistory = this.tokenHistory.filter((r) => now - r.timestamp <= 60_000);

    // 2) Sum remaining tokens (currentTpm).
    const currentTpm = this.tokenHistory.reduce((sum, r) => sum + r.tokens, 0);

    // 3) If adding would exceed 180k (20k buffer), wait until oldest falls out.
    if (currentTpm + estimatedTokens > 180_000) {
      const oldestRecord = this.tokenHistory[0];
      if (!oldestRecord) {
        // If no records but somehow over budget, just short sleep.
        await new Promise((resolve) => setTimeout(resolve, 250));
        return this.throttleForText(textChunk);
      }
      const waitTime = 60_000 - (now - oldestRecord.timestamp);
      if (waitTime > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[openai][throttle] waiting ${waitTime}ms (window=${currentTpm} + est=${estimatedTokens} > 180000)`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
      // Recursively ensure window is clear.
      return this.throttleForText(textChunk);
    }

    // 4) Push new record.
    this.tokenHistory.push({ timestamp: Date.now(), tokens: estimatedTokens });
  }

  async mapChunkToNotes(prompt: string): Promise<{ notes: string[] }> {
    // eslint-disable-next-line no-console
    console.log(`[openai] mapChunkToNotes estTokens=${this.estimateTokens(prompt)}`);
    await this.throttleForText(prompt);

    const jsonSchema = {
      name: "chunk_notes",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          notes: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["notes"],
      },
    } as const;

    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_schema", json_schema: jsonSchema },
    });

    const content = res.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(content);
    const notes = Array.isArray(parsed?.notes) ? parsed.notes.map((n: any) => String(n)) : [];
    return { notes };
  }

  async reduceNotesToQuestions(prompt: string): Promise<QuestionDraft[]> {
    // eslint-disable-next-line no-console
    console.log(`[openai] reduceNotesToQuestions estTokens=${this.estimateTokens(prompt)}`);
    await this.throttleForText(prompt);

    const jsonSchema = {
      name: "quiz_questions",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          questions: {
            type: "array",
            minItems: 20,
            maxItems: 20,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                question_text: { type: "string" },
                choices: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 4,
                  maxItems: 4,
                },
                correct_answer: { type: "string" },
              },
              required: ["question_text", "choices", "correct_answer"],
            },
          },
        },
        required: ["questions"],
      },
    } as const;

    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_schema", json_schema: jsonSchema },
    });

    const content = res.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(content);
    const out = normalizeQuestions(parsed?.questions || []);
    if (out.length !== 20) {
      throw new Error(`OpenAI returned ${out.length} valid questions (expected exactly 20).`);
    }
    return out;
  }

  async generateQuestions(input: LLMJobInput): Promise<QuestionDraft[]> {
    // Backward compatible wrapper. Prefer use-case orchestration.
    if (input.kind !== "text") {
      throw new Error(
        "OpenAIAdapter currently supports text inputs for map-reduce. Provide `text` in the job payload (PDF must be pre-extracted to text).",
      );
    }

    // Minimal internal orchestration (kept for compatibility).
    const notes = await this.mapChunkToNotes(input.text);
    const prompt = [
      "Using the notes below, generate 20 multiple-choice questions.",
      "Return ONLY JSON as an array.",
      "Notes:",
      ...notes.notes.map((n) => `- ${n}`),
    ].join("\n");
    return this.reduceNotesToQuestions(prompt);
  }
}

