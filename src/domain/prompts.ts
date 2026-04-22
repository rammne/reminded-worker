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
    "- Phrase each note as an atomic declarative claim (single fact/definition/rule), not as a question.",
    "- Avoid duplicates and filler.",
    "",
    `Chunk #${chunk.index}:`,
    chunk.text,
  ].join("\n");
}

export function reducePromptForQuestions(allNotes: string[]) {
  return [
    "You are an expert Assessment Designer generating rapid-fire multiple-choice questions for a spaced-repetition flashcard system.",
    "You are capable of processing text from any discipline.",
    "You must strictly adhere to Bloom's Taxonomy Lower-Order Thinking Skills (LOTS).",
    "Do NOT generate Higher-Order questions (Analyzing, Evaluating, Creating).",
    "",
    "Using ONLY the notes below, generate EXACTLY 20 multiple-choice questions (not 19, not 21).",
    "Each question maps to ONE LOTS level per the strict distribution at the end (Remembering, Understanding, or Applying).",
    "",
    'THE "ATOMIC KNOWLEDGE" PRINCIPLE & TIMING THRESHOLD:',
    "Our system awards a perfect quality score if the student answers within 10 seconds. This tests instant recall.",
    "Therefore, enforce Atomic Knowledge: test a single, isolated neural pathway without a complex web of ideas.",
    "",
    "ATOMIC STEM RULES (apply to EVERY `question_text`; non-compliance is a failure):",
    "- Zero-Context Rule: do NOT write premises, scenarios, or introductory sentences.",
    "- Question Length: `question_text` MUST be a single, highly direct sentence (e.g., Who/What/Where/When/Why/How).",
    "- Atomic Focus: each question tests exactly ONE isolated fact, definition, or single-variable calculation from the notes.",
    "- Do NOT bundle multiple clauses, comparisons, or multi-step reasoning into one question.",
    "",
    "EXAMPLE OF REQUIRED ATOMIC BREVITY:",
    '[POOR / NON-ATOMIC]: "During the cellular process of photosynthesis, which specific organelle is responsible for housing the chlorophyll necessary for this transformation?"',
    '[EXCELLENT / ATOMIC]: "Which organelle houses chlorophyll during photosynthesis?"',
    "",
    "LOTS STYLE GUIDE (do NOT label levels in output text; encode via question style only):",
    "1. REMEMBERING — rote recall of facts, dates, or definitions.",
    '   Example: "What is the primary function of a mitochondria?"',
    "2. UNDERSTANDING — comprehension without complex implementation.",
    '   Example: "How did the Industrial Revolution affect urbanization?"',
    "3. APPLYING — use a concept or rule in a basic numeric or situational case from the notes.",
    '   Example: "What is the net profit if revenue is $50k and costs are $30k?"',
    "Adapt examples to the discipline of the notes; keep stems atomic and single-sentence.",
    "",
    "Return ONLY JSON in this exact shape:",
    `{ "questions": [{ "question_text": string, "choices": string[4], "correct_answer": string }] }`,
    "",
    "CRITICAL CONSTRAINTS:",
    "- EXACTLY 4 choices per question. Each choice MUST be 1 to 5 words maximum.",
    "- ONLY ONE choice can be strictly correct.",
    "- Distractors must be plausible but immediately distinguishable.",
    "- `correct_answer` MUST exactly match one of the 4 `choices` strings.",
    "- Choices must be unique and mutually exclusive.",
    "",
    "REQUIRED DISTRIBUTION (STRICT):",
    "- EXACTLY 6 Remembering questions, EXACTLY 7 Understanding questions, EXACTLY 7 Applying questions (total 20).",
    "- Enforce this by ORDERING the `questions` array as follows:",
    "  - questions[0..5] (6 total): Remembering-style",
    "  - questions[6..12] (7 total): Understanding-style",
    "  - questions[13..19] (7 total): Applying-style",
    "- Do NOT include any labels like Remembering/Understanding/Applying in the stem text; only the style should reflect the level.",
    "- Vary topics across the notes; avoid duplicates.",
    "",
    "FINAL CHECK before you output JSON: for all 20 items, each `question_text` must be exactly ONE sentence, with NO context/premise sentence, and must test exactly ONE atomic point from the notes.",
    "",
    "Notes:",
    ...allNotes.map((n) => `- ${n}`),
  ].join("\n");
}

