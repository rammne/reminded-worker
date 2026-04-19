import type { QuestionDraft } from "../ports/ILLMService";

export function normalizeQuestions(raw: unknown): QuestionDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: QuestionDraft[] = [];

  for (const item of raw) {
    const q = item as any;
    const question_text = typeof q?.question_text === "string" ? q.question_text.trim() : "";
    const choices = Array.isArray(q?.choices) ? q.choices.map((c: any) => String(c).trim()) : [];
    const correct_answer = typeof q?.correct_answer === "string" ? q.correct_answer.trim() : "";

    if (!question_text || choices.length < 2 || !correct_answer) continue;
    out.push({ question_text, choices, correct_answer });
  }

  return out;
}

export function distributeAnswerPositions<T extends { choices: string[]; correct_answer: string }>(
  questions: T[],
): T[] {
  return questions.map((q, idx) => {
    const choices = [...q.choices];
    const correctIdx = choices.indexOf(q.correct_answer);
    if (correctIdx === -1) return q;

    const targetPos = idx % choices.length;
    if (correctIdx !== targetPos) {
      const tmp = choices[targetPos];
      choices[targetPos] = choices[correctIdx];
      choices[correctIdx] = tmp;
    }
    return { ...q, choices };
  });
}

