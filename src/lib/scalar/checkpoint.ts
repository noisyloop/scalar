import type { Checkpoint, Exemplar, PresetId } from "@/lib/scalar/types";

export const EMPTY_CHECKPOINT: Checkpoint = {
  version: 0,
  updatedAt: null,
  lessons: [],
  avoid: [],
  exemplars: [],
  scores: [],
  history: [],
  dataset: [],
};

// Checkpoints saved before history and dataset existed load with empty ones.
export function normalizeCheckpoint(value: Partial<Checkpoint> | null | undefined): Checkpoint {
  return {
    ...EMPTY_CHECKPOINT,
    ...value,
    history: Array.isArray(value?.history) ? value.history : [],
    dataset: Array.isArray(value?.dataset) ? value.dataset : [],
  };
}

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
    trainRow: Exemplar;
    preset: PresetId;
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

  const lessons = dedupe([...patch.lessons, ...prev.lessons], 12);
  const avoid = dedupe([...patch.avoid, ...prev.avoid], 8);
  const version = prev.version + 1;

  return {
    version,
    updatedAt: patch.at,
    lessons,
    avoid,
    exemplars,
    scores: [...prev.scores, patch.reward].slice(-24),
    history: [
      ...prev.history,
      {
        version,
        at: patch.at,
        reward: patch.reward,
        preset: patch.preset,
        added: lessons.filter((item) => !prev.lessons.includes(item)),
        banned: avoid.filter((item) => !prev.avoid.includes(item)),
      },
    ].slice(-24),
    dataset: [...prev.dataset, patch.trainRow].slice(-64),
  };
}
