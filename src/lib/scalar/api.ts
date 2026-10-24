import { createServerFn } from "@tanstack/react-start";
import { grade } from "@/lib/scalar/grade";
import { runTool } from "@/lib/scalar/tools";
import type { Exemplar, LoopRequest, LoopResult, PresetId, TraceEvent } from "@/lib/scalar/types";

// Any OpenAI-compatible endpoint works, including a ScalarLM deployment (vLLM under the hood).
// Without overrides the loop runs on xAI.
function llmConfig() {
  const apiKey = process.env.SCALAR_LLM_API_KEY || process.env.XAI_API_KEY || "";
  const baseUrl = (process.env.SCALAR_LLM_BASE_URL || "https://api.x.ai/v1").replace(/\/+$/, "");
  const model = process.env.SCALAR_LLM_MODEL || "grok-4.5";
  const ready = Boolean(apiKey) || Boolean(process.env.SCALAR_LLM_BASE_URL);
  return { apiKey, baseUrl, model, ready };
}

const PRESETS = new Set<PresetId>(["review", "threat", "plan", "harmony"]);

const TOOLS = [
  {
    type: "function",
    function: {
      name: "scan_artifact",
      description:
        "Scan the attached artifact for secrets, injection, weak crypto, and trust-boundary issues. Takes no arguments.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "arithmetic",
      description:
        "Evaluate one plain arithmetic expression. Required before any count, duration, or comparison.",
      parameters: {
        type: "object",
        properties: {
          expr: { type: "string", description: "Example: (25*5)-150" },
        },
        required: ["expr"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "music_check",
      description:
        "Report parallel motion, cadence, and one substitution for a chord progression.",
      parameters: {
        type: "object",
        properties: {
          progression: { type: "string", description: "Chords separated by spaces" },
        },
        required: ["progression"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "regex_scan",
      description: "Search the artifact with a short regular expression.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          flags: { type: "string" },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
    },
  },
];

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ChatMessage = {
  role: string;
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

function clip(value: string, max: number) {
  return value.trim().slice(0, max);
}

function sanitize(input: LoopRequest): LoopRequest | string {
  if (!input || typeof input !== "object") return "Bad request.";
  if (!PRESETS.has(input.preset)) return "Unknown mission type.";
  const mission = clip(String(input.mission ?? ""), 2000);
  if (!mission) return "Write a mission first.";
  const artifact = String(input.artifact ?? "").slice(0, 8000);
  const checkpoint = input.checkpoint;
  if (
    !checkpoint ||
    !Array.isArray(checkpoint.lessons) ||
    !Array.isArray(checkpoint.avoid) ||
    !Array.isArray(checkpoint.exemplars)
  ) {
    return "Checkpoint is missing.";
  }
  return {
    preset: input.preset,
    mission,
    artifact,
    checkpoint: {
      version: Number(checkpoint.version) || 0,
      lessons: checkpoint.lessons.map((item) => clip(String(item), 220)).slice(0, 12),
      avoid: checkpoint.avoid.map((item) => clip(String(item), 220)).slice(0, 8),
      exemplars: checkpoint.exemplars.slice(0, 2).map((item) => ({
        prompt: clip(String(item?.prompt ?? ""), 400),
        completion: clip(String(item?.completion ?? ""), 600),
      })),
    },
  };
}

function requiredTool(preset: PresetId): string {
  if (preset === "plan") return "arithmetic";
  if (preset === "harmony") return "music_check";
  return "scan_artifact";
}

function systemPrompt(input: LoopRequest) {
  const lessons = input.checkpoint.lessons.length
    ? input.checkpoint.lessons.map((item) => `- ${item}`).join("\n")
    : "- (none yet)";
  const avoid = input.checkpoint.avoid.length
    ? input.checkpoint.avoid.map((item) => `- ${item}`).join("\n")
    : "- (none)";
  const example = input.checkpoint.exemplars
    .map((prior) => `\nPRIOR GOOD FINISH\nMission: ${prior.prompt}\nDeliverable: ${prior.completion}\n`)
    .join("");
  return `You are the Scalar agent. A checkpoint from the last training step is hot-loaded below. Obey it over your defaults.

CHECKPOINT v${input.checkpoint.version}
Lessons:
${lessons}
Avoid:
${avoid}
${example}
Base policy:
- Call a tool before you state a measurement, a finding, or a harmonic fact.
- Code review and threat models call scan_artifact first.
- Any count, duration, or comparison calls arithmetic. Never do that math in prose first.
- Chord missions call music_check.
- The final reply is plain prose under 180 words. Short labeled lines. No preamble, no JSON.
- If a tool result contradicts you, the tool wins. Do not invent findings.`;
}

function userPrompt(input: LoopRequest) {
  return `MISSION\n${input.mission}\n\nARTIFACT\n${input.artifact.trim() || "(none)"}`;
}

async function complete(messages: ChatMessage[], tools: boolean, maxTokens: number) {
  const { apiKey, baseUrl, model, ready } = llmConfig();
  if (!ready) throw new Error("AI is not available in this environment.");
  const body: Record<string, unknown> = {
    model,
    temperature: tools ? 0.3 : 0.2,
    max_tokens: maxTokens,
    messages,
  };
  if (tools) body.tools = TOOLS;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error("The model is rate-limited. Wait a moment and run again.");
    throw new Error(`Model request failed (${res.status}).`);
  }
  const payload = (await res.json()) as {
    choices?: { message?: ChatMessage }[];
  };
  const message = payload.choices?.[0]?.message;
  if (!message) throw new Error("The model returned an empty reply.");
  return message;
}

function asArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function extractJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const source = fenced?.[1] ?? text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(source.slice(start, end + 1)) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function strings(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length >= 8 && item.length <= 220)
    .slice(0, limit);
}

function event(phase: TraceEvent["phase"], title: string, body: string): TraceEvent {
  return { id: crypto.randomUUID(), phase, title, body };
}

export const getLoopStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { model, ready } = llmConfig();
  return { ready, model };
});

export const runClosedLoop = createServerFn({ method: "POST" })
  .validator((input: LoopRequest) => input)
  .handler(async ({ data }): Promise<LoopResult> => {
    const clean = sanitize(data);
    if (typeof clean === "string") return { ok: false, error: clean };

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt(clean) },
      { role: "user", content: userPrompt(clean) },
    ];
    const events: TraceEvent[] = [];
    const called: string[] = [];
    const toolBodies: string[] = [];
    let deliverable = "";
    const need = requiredTool(clean.preset);

    try {
      for (let step = 0; step < 5 && !deliverable; step++) {
        const message = await complete(messages, true, 700);
        const calls = (message.tool_calls ?? []).map((call, index) => ({
          id: call.id || `call_${step}_${index}`,
          type: "function" as const,
          function: {
            name: call.function?.name ?? "unknown",
            arguments: call.function?.arguments ?? "{}",
          },
        }));
        messages.push({
          role: "assistant",
          content: message.content ?? null,
          tool_calls: calls.length ? calls : undefined,
        });

        if (calls.length) {
          if (message.content?.trim()) {
            events.push(event("infer", "Infer", clip(message.content, 400)));
          }
          for (const call of calls) {
            const name = call.function?.name ?? "unknown";
            const args = asArgs(call.function?.arguments);
            const result = runTool(name, args, clean.artifact).slice(0, 1500);
            called.push(name);
            toolBodies.push(result);
            const argNote =
              typeof args.expr === "string"
                ? args.expr
                : typeof args.progression === "string"
                  ? args.progression
                  : typeof args.pattern === "string"
                    ? args.pattern
                    : "";
            events.push(
              event(
                "tool",
                `Tool · ${name}`,
                argNote ? `${argNote}\n${result}` : result,
              ),
            );
            messages.push({
              role: "tool",
              tool_call_id: call.id || `call_${step}_${name}`,
              content: result,
            });
          }
          continue;
        }

        const text = (message.content ?? "").trim();
        if (!called.includes(need) && step < 4) {
          events.push(
            event(
              "infer",
              "Infer",
              text ? clip(text, 280) : "Tried to finish before the required tool.",
            ),
          );
          messages.push({
            role: "user",
            content: `Stop. Call ${need} before the final answer. Do not answer yet.`,
          });
          continue;
        }

        // The runtime can only stand in for tools whose input it already has. Arithmetic needs an
        // expression from the model, so a run that never calls it keeps its text and takes the cap.
        if (!called.includes(need) && need !== "arithmetic" && clean.artifact.trim()) {
          const result = runTool(need, {}, clean.artifact);
          called.push(need);
          toolBodies.push(result);
          events.push(event("tool", `Tool · ${need}`, result));
          messages.push({
            role: "user",
            content: `The runtime ran ${need} because the step ended without it.\n${result}\nRewrite the final answer from this result. Plain prose only.`,
          });
          const rewrite = await complete(messages, false, 700);
          deliverable = (rewrite.content ?? "").trim() || text;
          events.push(event("infer", "Infer · rewrite", "Rewritten from the tool result."));
          break;
        }

        deliverable = text;
        events.push(event("infer", "Infer · finish", "Final answer is in the deliverable."));
      }
      if (!deliverable) {
        messages.push({
          role: "user",
          content: "Write the final answer now. Plain prose only. Do not call tools.",
        });
        const rewrite = await complete(messages, false, 700);
        deliverable = (rewrite.content ?? "").trim();
        if (deliverable) {
          events.push(event("infer", "Infer · finish", "Final answer is in the deliverable."));
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The loop failed.";
      return { ok: false, error: message };
    }

    if (!deliverable) {
      return { ok: false, error: "The agent stopped without an answer." };
    }

    const toolText = toolBodies.join("\n");
    let modelReward = 0.7;
    let modelLessons: string[] = [];
    let modelAvoid: string[] = [];
    let criticExemplar: Exemplar | null = null;

    try {
      const critic = await complete(
        [
          {
            role: "system",
            content: `You score an agent trace and emit a small post-training update. Reply with JSON only:
{"reward":0.0,"notes":"","lessons":[],"avoid":[],"exemplar_prompt":"","exemplar_completion":""}
reward is 0 to 1. Penalize skipped tools, invented numbers, and ignored findings.
lessons: at most 2 new imperatives, empty if the checkpoint already covers this.
avoid: at most 1. exemplar fields can be empty.`,
          },
          {
            role: "user",
            content: `CHECKPOINT LESSONS\n${clean.checkpoint.lessons.join("\n") || "(none)"}\n\nTOOLS CALLED\n${called.join(", ") || "(none)"}\n\nTOOL LOG\n${toolText || "(none)"}\n\nDELIVERABLE\n${deliverable.slice(0, 1800)}`,
          },
        ],
        false,
        450,
      );
      const parsed = extractJson(critic.content ?? "");
      if (parsed) {
        if (typeof parsed.reward === "number") modelReward = parsed.reward;
        modelLessons = strings(parsed.lessons, 2);
        modelAvoid = strings(parsed.avoid, 1);
        const prompt = typeof parsed.exemplar_prompt === "string" ? parsed.exemplar_prompt.trim() : "";
        const completion =
          typeof parsed.exemplar_completion === "string" ? parsed.exemplar_completion.trim() : "";
        if (prompt.length >= 8 && completion.length >= 20) {
          criticExemplar = { prompt: clip(prompt, 300), completion: clip(completion, 500) };
        }
      }
    } catch {
      modelReward = 0.6;
    }

    const graded = grade({
      preset: clean.preset,
      called,
      deliverable,
      artifact: clean.artifact,
      toolText,
      modelReward,
      modelLessons,
      modelAvoid,
    });

    const exemplar =
      graded.reward >= 0.75
        ? {
            prompt: clip(clean.mission, 280),
            completion: clip(deliverable, 500),
          }
        : criticExemplar;

    const trainRow: Exemplar = exemplar ?? {
      prompt: clip(clean.mission, 280),
      completion: graded.lessons[0] ?? clip(deliverable, 500),
    };

    events.push(
      event(
        "reward",
        `Reward · ${graded.reward.toFixed(2)}`,
        graded.rubric,
      ),
    );
    events.push(
      event(
        "train",
        "Train · dataset.jsonlines",
        graded.lessons.length
          ? `Lessons written into the next checkpoint.\n${graded.lessons.map((item) => `- ${item}`).join("\n")}`
          : "No new lesson text. The score is still on the checkpoint.",
      ),
    );

    return {
      ok: true,
      model: llmConfig().model,
      deliverable,
      events,
      reward: graded.reward,
      rubric: graded.rubric,
      lessons: graded.lessons,
      avoid: graded.avoid,
      exemplar,
      trainRow,
    };
  });
