import type { Chunk } from "./chunking";

/**
 * Pure prompt formatters (no external deps).
 * Keep these short: the worker will do map-reduce, so each prompt is small.
 */

export function mapPromptForChunk(chunk: Chunk) {
  return [
    "You are extracting study facts from a document chunk.",
    "Return ONLY JSON.",
    "",
    "JSON schema:",
    `{ "notes": string[], "keywords": string[] }`,
    "",
    "Rules:",
    "- Notes must be concise (<= 18 words each).",
    "- Prefer definitions, formulas, rules, and key distinctions.",
    "- Avoid duplicates and filler.",
    "",
    `Chunk #${chunk.index}:`,
    chunk.text,
  ].join("\n");
}

export function reducePromptForQuestions(allNotes: string[]) {
  return [
    "Using ONLY the notes below, generate EXACTLY 20 multiple-choice questions (not 19, not 21).",
    "All questions must align to Bloom's LOTS (Lower Order Thinking Skills) ONLY:",
    "- Remember (recall/recognize a fact, term, definition)",
    "- Understand (explain/interpret; identify meaning or relationship)",
    "- Apply (use a rule/formula/procedure in a simple situation)",
    "",
    "Return ONLY JSON in this exact shape:",
    `{ "questions": [{ "question_text": string, "choices": string[4], "correct_answer": string }] }`,
    "",
    "CRITICAL CONSTRAINTS:",
    "- EXACTLY 4 choices per question.",
    "- ONLY ONE choice can be strictly correct.",
    "- Wrong choices MUST be plausible misconceptions or common errors (not silly or obviously wrong).",
    "- `correct_answer` MUST exactly match one of the 4 `choices` strings.",
    "- Choices must be unique and mutually exclusive.",
    "- Keep each of the four `choices` clear and succinct; the stem (`question_text`) follows QUALITY AND STRUCTURE below and may be longer when context-framing is needed.",
    "- The whole item should remain answerable within ~15-20 seconds of careful reading.",
    "",
    "LOTS STRUCTURE (do NOT label levels; encode via question style):",
    "- Remember: ask for a definition, key term, fact, component, or direct recall.",
    "- Understand: ask for best explanation, paraphrase, interpretation, or identifying a relationship.",
    "- Apply: give a minimal concrete situation and ask which step/result follows from the rule/formula.",
    "",
    "QUALITY AND STRUCTURE CONSTRAINTS (for every `question_text`; still obey LOTS levels and distribution above):",
    '- Structure every question using "Context-Framing": provide a 1-to-2 sentence premise, technical scenario, or foundational context from the notes before asking the final question.',
    "- Avoid brevity: do NOT write single-sentence questions (e.g., \"What does X do?\").",
    "- Avoid bloat: do NOT pad with conversational filler, redundant adjectives, or repetitive phrasing.",
    "- Maintain an academic, highly descriptive, and direct tone.",
    "",
    "EXAMPLE OF REQUIRED QUESTION STRUCTURE:",
    '[POOR / TOO SHORT]: \"What is the primary function of a mutex in concurrent programming?\"',
    "[EXCELLENT / CONTEXT-FRAMED]: \"When designing a multi-threaded application, race conditions can occur if multiple threads attempt to modify a shared resource simultaneously. Which synchronization primitive is specifically implemented to lock the resource and enforce mutual exclusion?\"",
    "",
    "REQUIRED DISTRIBUTION (STRICT):",
    "- EXACTLY 6 Remember questions, EXACTLY 7 Understand questions, EXACTLY 7 Apply questions (total 20).",
    "- Enforce this by ORDERING the `questions` array as follows:",
    "  - questions[0..5] (6 total): Remember-style",
    "  - questions[6..12] (7 total): Understand-style",
    "  - questions[13..19] (7 total): Apply-style",
    "- Do NOT include any labels like 'Remember/Understand/Apply' in the text; only the style should reflect the level.",
    "- Vary topics across the notes; avoid duplicates.",
    "",
    "Notes:",
    ...allNotes.map((n) => `- ${n}`),
  ].join("\n");
}

