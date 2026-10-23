import type { Checkpoint, Exemplar } from "@/lib/scalar/types";

export const EMPTY_CHECKPOINT: Checkpoint = {
  version: 0,
  updatedAt: null,
  lessons: [],
  avoid: [],
  exemplars: [],
  scores: [],
};

function dedupe(items: string[], limit: number) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const text = item.trim();
    const key = text.toLowerCase();
    if (text.length < 8 || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

export function nextCheckpoint(
  prev: Checkpoint,
  patch: {
    reward: number;
    lessons: string[];
    avoid: string[];
    exemplar: Exemplar | null;
    at: number;
  },
): Checkpoint {
  const exemplars = patch.exemplar
    ? [
        patch.exemplar,
        ...prev.exemplars.filter(
          (item) => item.completion.trim() !== patch.exemplar?.completion.trim(),
        ),
      ].slice(0, 3)
    : prev.exemplars;

  return {
    version: prev.version + 1,
    updatedAt: patch.at,
    lessons: dedupe([...patch.lessons, ...prev.lessons], 12),
    avoid: dedupe([...patch.avoid, ...prev.avoid], 8),
    exemplars,
    scores: [...prev.scores, patch.reward].slice(-12),
  };
}
