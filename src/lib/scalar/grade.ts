import type { PresetId } from "@/lib/scalar/types";

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function mentions(text: string, pattern: RegExp) {
  return pattern.test(text);
}

export function grade(input: {
  preset: PresetId;
  called: string[];
  deliverable: string;
  toolText: string;
  modelReward: number;
  modelLessons: string[];
  modelAvoid: string[];
}): { reward: number; lessons: string[]; avoid: string[]; rubric: string } {
  const called = new Set(input.called);
  const text = input.deliverable;
  let cap = 1;
  let rubric = "Graded against the tool log.";
  const lessons: string[] = [];
  const avoid: string[] = [];

  if ((input.preset === "review" || input.preset === "threat") && !called.has("scan_artifact")) {
    cap = Math.min(cap, 0.35);
    rubric = "Capped: scan_artifact never ran.";
    lessons.push("Call scan_artifact before writing findings. Guessing is not a review.");
  }

  if (input.preset === "review" && called.has("scan_artifact")) {
    const named =
      mentions(text, /innerHTML/i) &&
      mentions(text, /sql|concat/i) &&
      mentions(text, /AKIA|access key|aws/i) &&
      mentions(text, /md5/i);
    if (!named) {
      cap = Math.min(cap, 0.5);
      rubric = "Capped: the scan's high findings were not all named.";
      lessons.push(
        "Name each high hit: SQL concatenation, the AKIA key, innerHTML, and MD5.",
      );
    }
  }

  if (input.preset === "threat" && called.has("scan_artifact")) {
    const named =
      mentions(text, /signature/i) &&
      mentions(text, /log/i) &&
      mentions(text, /user id|userid|body/i);
    if (!named) {
      cap = Math.min(cap, 0.55);
      rubric = "Capped: the design's trust breaks were not all named.";
      lessons.push(
        "Name the conditional signature, the full-body log, and the user id taken from JSON.",
      );
    }
  }

  if (input.preset === "plan") {
    if (!called.has("arithmetic")) {
      cap = Math.min(cap, 0.3);
      rubric = "Capped: a weekly total was stated without arithmetic.";
      lessons.push("Run arithmetic before any total. 25×5 is 125, which misses 150 by 25.");
    } else if (
      mentions(text, /meets|clears|enough|satisfies|hits the/i) &&
      !mentions(text, /miss|short|below|under|does not|doesn't|deficit|−|- ?25|not meet/i)
    ) {
      cap = Math.min(cap, 0.4);
      rubric = "Capped: 125 was treated as if it met 150.";
      lessons.push("125 is short of 150 by 25. Say that the week misses the floor. A second week does not make up the first.");
      avoid.push("Do not say the block meets 150 minutes.");
    }
  }

  if (input.preset === "harmony") {
    if (!called.has("music_check")) {
      cap = Math.min(cap, 0.35);
      rubric = "Capped: music_check never ran.";
      lessons.push("Call music_check before describing motion or a cadence.");
    } else if (input.toolText.includes("parallel") && !mentions(text, /parallel/i)) {
      cap = Math.min(cap, 0.5);
      rubric = "Capped: parallel fifths were in the tool log and missing from the answer.";
      lessons.push("Name the parallel fifth pairs: F–C, C–G, and Am–Em.");
    } else if (!mentions(text, /\bDm\b|D minor/i)) {
      cap = Math.min(cap, 0.72);
      rubric = "Soft cap: no substitution that stays in A minor.";
      lessons.push("Offer Dm in place of the final G. It stays in A natural minor and lands less neatly.");
    }
  }

  const reward = Math.round(Math.min(clamp01(input.modelReward), cap) * 100) / 100;
  const clean = (items: string[]) =>
    items.map((item) => item.trim()).filter((item) => item.length >= 8 && item.length <= 220);

  return {
    reward,
    lessons: [...new Set([...clean(lessons), ...clean(input.modelLessons)])].slice(0, 2),
    avoid: [...new Set([...clean(avoid), ...clean(input.modelAvoid)])].slice(0, 1),
    rubric,
  };
}
