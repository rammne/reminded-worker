import type { ILLMService, LLMJobInput, QuestionDraft } from "../ports/ILLMService";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockLLMAdapter implements ILLMService {
  async mapChunkToNotes(_prompt: string): Promise<{ notes: string[] }> {
    console.log("🛠️ [MOCK LLM] Simulating 3s latency for method: mapChunkToNotes...");
    await sleep(3000);
    return {
      notes: [
        "Definition: spaced repetition improves long-term recall.",
        "Rule: correct answers must appear among choices.",
        "Key idea: keep questions short and fast.",
      ],
    };
  }

  async reduceNotesToQuestions(_prompt: string): Promise<QuestionDraft[]> {
    console.log("🛠️ [MOCK LLM] Simulating 3s latency for method: reduceNotesToQuestions...");
    await sleep(3000);
    return [
      {
        question_text: "What improves long-term recall?",
        choices: ["Spaced repetition", "Cramming", "Guessing", "Skipping"],
        correct_answer: "Spaced repetition",
      },
      {
        question_text: "Which choice rule is correct?",
        choices: ["Include correct answer", "Hide correct answer", "Use duplicates", "Use long options"],
        correct_answer: "Include correct answer",
      },
    ];
  }

  async generateQuestions(_input: LLMJobInput): Promise<QuestionDraft[]> {
    console.log("🛠️ [MOCK LLM] Simulating 3s latency for method: generateQuestions...");
    await sleep(3000);
    // Keep this valid even if called directly.
    return [
      {
        question_text: "What is the best study method here?",
        choices: ["Spaced repetition", "All-nighter", "Random review", "No review"],
        correct_answer: "Spaced repetition",
      },
      {
        question_text: "How many options are typical?",
        choices: ["4", "1", "10", "0"],
        correct_answer: "4",
      },
    ];
  }
}

