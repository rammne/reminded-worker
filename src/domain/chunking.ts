/**
 * Pure chunking logic (no external deps).
 */

export type Chunk = {
  index: number;
  text: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Splits text into reasonably sized chunks while trying to break on paragraph boundaries.
 * Uses character counts rather than tokens to avoid external tokenizers.
 */
export function chunkText(
  text: string,
  opts?: {
    targetChars?: number;
    minChars?: number;
    maxChars?: number;
  },
): Chunk[] {
  const normalized = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) return [];

  const target = opts?.targetChars ?? 6000;
  const min = clamp(opts?.minChars ?? 3500, 500, target);
  const max = clamp(opts?.maxChars ?? 8500, target, 20000);

  const paragraphs = normalized.split("\n\n");
  const chunks: Chunk[] = [];
  let buf = "";

  const pushBuf = () => {
    const t = buf.trim();
    if (!t) return;
    chunks.push({ index: chunks.length, text: t });
    buf = "";
  };

  for (const p of paragraphs) {
    const para = p.trim();
    if (!para) continue;

    if (!buf) {
      buf = para;
      continue;
    }

    if (buf.length + 2 + para.length <= target) {
      buf = `${buf}\n\n${para}`;
      continue;
    }

    // If current buffer is at least min, push it and start new.
    if (buf.length >= min) {
      pushBuf();
      buf = para;
      continue;
    }

    // Buffer is too small but next paragraph would exceed target.
    // Keep adding until we reach min or hit max.
    if (buf.length + 2 + para.length <= max) {
      buf = `${buf}\n\n${para}`;
      continue;
    }

    // Extreme case: paragraph itself is huge; hard-split.
    const combined = `${buf}\n\n${para}`;
    let i = 0;
    while (i < combined.length) {
      const slice = combined.slice(i, i + target);
      chunks.push({ index: chunks.length, text: slice.trim() });
      i += target;
    }
    buf = "";
  }

  pushBuf();
  return chunks;
}

