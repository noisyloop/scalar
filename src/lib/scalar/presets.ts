import type { PresetId } from "@/lib/scalar/types";

export type Preset = {
  id: PresetId;
  label: string;
  mission: string;
  artifact: string;
  artifactLabel: string;
};

export const PRESETS: Preset[] = [
  {
    id: "review",
    label: "Review",
    artifactLabel: "Snippet",
    mission:
      "Review this snippet before it ships. Name the concrete bugs, how each one is abused, and the smallest fix. Do not lecture.",
    artifact: `function getUser(id) {
  const q = "SELECT * FROM users WHERE id = " + id;
  const key = "AKIAIOSFODNN7EXAMPLE";
  return db.query(q);
}

function render(name) {
  document.getElementById("out").innerHTML = name;
}

function sign(payload) {
  return crypto.createHash("md5").update(payload).digest("hex");
}`,
  },
  {
    id: "threat",
    label: "Threat model",
    artifactLabel: "Design",
    mission:
      "Threat-model this webhook. List the abuses that follow from the design as written, worst first, and the one control that cuts the most risk.",
    artifact: `Payments webhook. We accept POSTs from the processor on /hooks/pay.
We log the full body, including card metadata, to the app log for debugging.
Signature check runs only if the X-Signature header is present.
On success we credit the user id in the JSON body. Retries are not deduped.
The endpoint is HTTP inside the VPC, called by a public worker that forwards the raw request.`,
  },
  {
    id: "plan",
    label: "Plan",
    artifactLabel: "Notes",
    mission:
      "Build a 14-day indoor block. I can train 25 minutes a day, 5 days a week. The floor is 150 minutes of moderate activity a week. Split walking-in-place and strength. Use arithmetic for the weekly total and the gap versus 150. Then say whether a second identical week makes the first week legal, and by how many minutes the week is over or under.",
    artifact: "",
  },
  {
    id: "harmony",
    label: "Harmony",
    artifactLabel: "Progression",
    mission:
      "Night-drive loop: dreamy, a little uneasy, not triumphant. Check the draft for parallel motion and a too-bright cadence. Propose one substitution that keeps A minor and lands less neatly. Name the chords.",
    artifact: "Am F C G | Am Em F G",
  },
];

export function presetById(id: PresetId) {
  return PRESETS.find((preset) => preset.id === id) ?? PRESETS[0];
}
