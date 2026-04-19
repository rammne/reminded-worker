export type QuestionDraft = {
  question_text: string;
  choices: string[];
  correct_answer: string;
};

export type LLMJobInput =
  | { kind: "text"; text: string }
  | { kind: "pdfBase64"; base64: string; mimeType?: "application/pdf" };

export interface ILLMService {
  /**
   * Map step: from a single chunk prompt → { notes } JSON.
   * The use case will call this sequentially across chunks.
   */
  mapChunkToNotes(prompt: string): Promise<{ notes: string[] }>;

  /**
   * Reduce step: from a combined notes prompt → questions JSON.
   */
  reduceNotesToQuestions(prompt: string): Promise<QuestionDraft[]>;

  /**
   * Backward-compatible convenience wrapper.
   * (Prefer orchestrating map-reduce in the use case.)
   */
  generateQuestions(input: LLMJobInput): Promise<QuestionDraft[]>;
}

