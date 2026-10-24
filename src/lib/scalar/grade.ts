import { scanHits } from "@/lib/scalar/tools";
import type { PresetId } from "@/lib/scalar/types";

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function mentions(text: string, pattern: RegExp) {
  return pattern.test(text);
}

function list(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// "25*5 = 125" lines from the arithmetic tool.
function arithmeticResults(toolText: string) {
  const out: { expr: string; value: number }[] = [];
  for (const line of toolText.split("\n")) {
    const match = line.match(/^([0-9+\-*/%.()]+) = (-?[0-9.]+)$/);
    if (match) out.push({ expr: match[1], value: Number(match[2]) });
  }
  return out;
}

function saysNumber(text: string, value: number) {
  const plain = String(Math.abs(value));
  const pattern = new RegExp(`(^|[^0-9.])${plain.replace(".", "\\.")}(?![0-9])`);
  return pattern.test(text.replace(/,(?=\d{3})/g, ""));
}

export function grade(input: {
  preset: PresetId;
  called: string[];
  deliverable: string;
  artifact: string;
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

  if ((input.preset === "review" || input.preset === "threat") && called.has("scan_artifact")) {
    const missed = scanHits(input.artifact).filter(
      (hit) => hit.sev === "high" && !mentions(text, hit.named),
    );
    if (missed.length) {
      cap = Math.min(cap, input.preset === "review" ? 0.5 : 0.55);
      rubric = `Capped: ${missed.length} high finding${missed.length === 1 ? " was" : "s were"} in the scan and missing from the answer.`;
      lessons.push(`Name every high hit from the scan, not just the first. Missed: ${list(missed.map((hit) => hit.msg))}.`);
    }
  }

  if (input.preset === "plan") {
    const results = arithmeticResults(input.toolText);
    const gap = results.find((item) => item.value < 0);
    if (!called.has("arithmetic") || !results.length) {
      cap = Math.min(cap, 0.3);
      rubric = "Capped: a total was stated without arithmetic.";
      lessons.push("Run arithmetic before any total or gap. Never do the math in prose.");
    } else if (
      gap &&
      mentions(text, /meets|clears|enough|satisfies|hits the/i) &&
      !mentions(text, /miss|short|below|under|does not|doesn't|deficit|not meet/i)
    ) {
      cap = Math.min(cap, 0.4);
      rubric = `Capped: ${gap.expr} came out at ${gap.value} and the answer said it was enough.`;
      lessons.push(
        `${gap.expr} is ${gap.value}. A negative gap means the plan falls short by ${Math.abs(gap.value)}. Say so plainly.`,
      );
      avoid.push("Do not say a plan meets a floor the arithmetic says it misses.");
    } else {
      const unsaid = results.filter((item) => !saysNumber(text, item.value));
      if (unsaid.length * 2 > results.length) {
        cap = Math.min(cap, 0.6);
        rubric = "Capped: the arithmetic results never made it into the answer.";
        lessons.push(
          `Quote each arithmetic result in the answer, like ${unsaid[0].expr} = ${unsaid[0].value}.`,
        );
      }
    }
  }

  if (input.preset === "harmony") {
    const pairs = [...input.toolText.matchAll(/parallel fifth motion (\S+) → (\S+)/g)].map(
      (match) => `${match[1]}–${match[2]}`,
    );
    const sub = input.toolText.match(/substitution {2}replace .+? with (\S+?)\./)?.[1];
    if (!called.has("music_check")) {
      cap = Math.min(cap, 0.35);
      rubric = "Capped: music_check never ran.";
      lessons.push("Call music_check before describing motion or a cadence.");
    } else if (pairs.length && !mentions(text, /parallel/i)) {
      cap = Math.min(cap, 0.5);
      rubric = "Capped: parallel fifths were in the tool log and missing from the answer.";
      lessons.push(`Name the parallel fifth pairs: ${list([...new Set(pairs)])}.`);
    } else if (sub && !text.includes(sub)) {
      cap = Math.min(cap, 0.72);
      rubric = `Soft cap: the tool's in-key substitution, ${sub}, was not offered.`;
      lessons.push(`Offer ${sub} as the substitution music_check found. It stays in key.`);
    }
  }

  const reward = Math.round(Math.min(clamp01(input.modelReward), cap) * 100) / 100;
  const clean = (items: string[]) =>
    items
      .map((item) => item.trim().slice(0, 220))
      .filter((item) => item.length >= 8);

  return {
    reward,
    lessons: [...new Set([...clean(lessons), ...clean(input.modelLessons)])].slice(0, 2),
    avoid: [...new Set([...clean(avoid), ...clean(input.modelAvoid)])].slice(0, 1),
    rubric,
  };
}
