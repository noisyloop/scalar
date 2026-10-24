import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getLoopStatus, runClosedLoop } from "@/lib/scalar/api";
import { PRESETS, useScalar } from "@/lib/scalar/store";
import type { Checkpoint, CheckpointStep, Job, TraceEvent } from "@/lib/scalar/types";

const EPOCHS = [1, 3, 5] as const;

function Sparkline({ scores }: { scores: number[] }) {
  const width = 112;
  const height = 32;
  const points =
    scores.length === 0
      ? ""
      : scores
          .map((score, index) => {
            const x = scores.length === 1 ? width / 2 : (index / (scores.length - 1)) * (width - 4) + 2;
            const y = height - 4 - Math.min(1, Math.max(0, score)) * (height - 8);
            return `${x},${y}`;
          })
          .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="text-accent">
      <line x1="2" y1={height - 4} x2={width - 2} y2={height - 4} stroke="currentColor" strokeOpacity="0.25" />
      {points ? (
        <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
      ) : null}
    </svg>
  );
}

function formatWhen(at: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(at);
}

function rewardClass(reward: number) {
  if (reward >= 0.75) return "text-good";
  if (reward < 0.5) return "text-bad";
  return "text-ink";
}

export function Console() {
  const preset = useScalar((state) => state.preset);
  const mission = useScalar((state) => state.mission);
  const artifact = useScalar((state) => state.artifact);
  const checkpoint = useScalar((state) => state.checkpoint);
  const jobs = useScalar((state) => state.jobs);
  const activeJobId = useScalar((state) => state.activeJobId);
  const setMission = useScalar((state) => state.setMission);
  const setArtifact = useScalar((state) => state.setArtifact);
  const setPreset = useScalar((state) => state.setPreset);
  const selectJob = useScalar((state) => state.selectJob);
  const commit = useScalar((state) => state.commit);
  const resetCheckpoint = useScalar((state) => state.resetCheckpoint);
  const clearJobs = useScalar((state) => state.clearJobs);

  const run = useServerFn(runClosedLoop);
  const status = useServerFn(getLoopStatus);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [epochs, setEpochs] = useState<(typeof EPOCHS)[number]>(3);
  const [progress, setProgress] = useState<{ epoch: number; of: number } | null>(null);
  const [model, setModel] = useState<{ ready: boolean; model: string } | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    void useScalar.persist.rehydrate();
    status()
      .then(setModel)
      .catch(() => setModel(null));
  }, [status]);

  const active = jobs.find((job) => job.id === activeJobId) ?? null;
  const prior =
    active && jobs[0]?.id === active.id
      ? jobs.slice(1).find((job) => job.mission === active.mission)
      : undefined;
  const presetMeta = PRESETS.find((item) => item.id === preset) ?? PRESETS[0];

  // Each epoch is one generate → grade → train step. The next epoch reads the checkpoint the
  // previous one just wrote, which is the whole point: the curve should climb.
  async function onRun() {
    if (running || !mission.trim()) return;
    const request = { preset, mission: mission.trim(), artifact };
    setRunning(true);
    setError(null);
    stopRef.current = false;
    try {
      for (let epoch = 1; epoch <= epochs; epoch++) {
        if (stopRef.current) break;
        setProgress({ epoch, of: epochs });
        const loaded = useScalar.getState().checkpoint;
        const result = await run({
          data: {
            ...request,
            checkpoint: {
              version: loaded.version,
              lessons: loaded.lessons,
              avoid: loaded.avoid,
              exemplars: loaded.exemplars,
            },
          },
        });
        if (!result.ok) {
          setError(epoch > 1 ? `Epoch ${epoch}: ${result.error}` : result.error);
          return;
        }
        commit(result, { preset: request.preset, mission: request.mission, epoch });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The loop failed.");
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void onRun();
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-end sm:justify-between md:px-6">
          <div>
            <p className="font-mono text-xs tracking-widest text-faint">SCALARLM · CC0</p>
            <h1 className="font-serif text-3xl leading-none">Scalar</h1>
            <p className="mt-2 max-w-xl text-sm text-muted">
              An agent that trains on its own trace. The next inference loads the checkpoint.
            </p>
            {model ? (
              <p className="mt-2 flex items-center gap-2 font-mono text-xs text-faint">
                <span
                  aria-hidden="true"
                  className={`inline-block size-1.5 rounded-full ${model.ready ? "bg-good" : "bg-bad"}`}
                />
                {model.ready ? `policy · ${model.model}` : "no model connected"}
              </p>
            ) : null}
          </div>
          <div className="flex items-end gap-4">
            <div>
              <p className="font-mono text-xs text-faint">reward</p>
              <Sparkline scores={checkpoint.scores} />
            </div>
            <div className="text-right">
              <p className="font-mono text-xs text-faint">checkpoint</p>
              <p className="font-mono text-lg tabular-nums text-ink">v{checkpoint.version}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-4 px-4 py-5 md:px-6 lg:grid-cols-2">
        <section className="min-w-0 rounded-xl border border-line bg-panel p-4">
          <h2 className="font-serif text-xl leading-snug">Mission</h2>
          <form
            className="mt-4 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void onRun();
            }}
          >
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-panel-2 p-1 sm:grid-cols-4">
              {PRESETS.map((item) => {
                const selected = item.id === preset;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setPreset(item.id)}
                    className={
                      selected
                        ? "min-h-11 rounded-md bg-accent px-2 text-sm font-medium text-accent-ink"
                        : "min-h-11 rounded-md px-2 text-sm text-muted"
                    }
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            <label className="grid gap-2">
              <span className="text-xs font-medium text-muted">What it should do</span>
              <textarea
                value={mission}
                onChange={(event) => setMission(event.target.value)}
                onKeyDown={onKeyDown}
                rows={5}
                className="min-h-11 w-full resize-y rounded-lg border border-line bg-canvas px-3 py-3 text-sm text-ink placeholder:text-faint"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-xs font-medium text-muted">{presetMeta.artifactLabel}</span>
              <textarea
                value={artifact}
                onChange={(event) => setArtifact(event.target.value)}
                onKeyDown={onKeyDown}
                rows={artifact ? 8 : 3}
                placeholder="Optional. The tools read this."
                className="min-h-11 w-full resize-y rounded-lg border border-line bg-canvas px-3 py-3 font-mono text-sm text-ink placeholder:font-sans placeholder:text-faint"
              />
            </label>

            <div className="grid gap-2">
              <span className="text-xs font-medium text-muted" id="epochs-label">
                Epochs
              </span>
              <div
                role="group"
                aria-labelledby="epochs-label"
                className="grid w-full grid-cols-3 gap-1 rounded-lg bg-panel-2 p-1 sm:w-64"
              >
                {EPOCHS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    aria-pressed={count === epochs}
                    disabled={running}
                    onClick={() => setEpochs(count)}
                    className={
                      count === epochs
                        ? "min-h-11 rounded-md bg-accent px-2 font-mono text-sm text-accent-ink"
                        : "min-h-11 rounded-md px-2 font-mono text-sm text-muted"
                    }
                  >
                    ×{count}
                  </button>
                ))}
              </div>
            </div>

            {model && !model.ready ? (
              <p className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-muted">
                No model is connected here yet, so runs cannot start. Everything below still loads
                from the saved checkpoint.
              </p>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {running ? (
                <button
                  type="button"
                  onClick={() => {
                    stopRef.current = true;
                  }}
                  className="min-h-11 rounded-lg border border-line px-4 text-sm font-medium text-ink"
                >
                  {progress ? `Epoch ${progress.epoch} of ${progress.of} · Stop after this` : "Stop"}
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={mission.trim().length === 0 || model?.ready === false}
                  className="min-h-11 rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink disabled:opacity-50"
                >
                  {epochs === 1 ? "Run closed loop" : `Train ${epochs} epochs`}
                </button>
              )}
              <p className="text-xs text-faint">
                {checkpoint.version > 0
                  ? `Checkpoint v${checkpoint.version} is loaded into the next run.`
                  : "First run writes v1."}{" "}
                <span className="hidden sm:inline">Ctrl+Enter</span>
              </p>
            </div>
          </form>
        </section>

        <section className="min-w-0 rounded-xl border border-line bg-panel p-4" aria-live="polite">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-serif text-xl leading-snug">Trace</h2>
            {active ? (
              <p className={`font-mono text-sm tabular-nums ${rewardClass(active.reward)}`}>
                {active.reward.toFixed(2)}
              </p>
            ) : null}
          </div>

          {running ? (
            <p className="mt-4 text-sm text-muted">
              {progress && progress.of > 1 ? `Epoch ${progress.epoch} of ${progress.of}. ` : ""}
              Infer, then tools, then reward, then train.
            </p>
          ) : null}
          {error ? <p className="mt-4 text-sm text-bad">{error}</p> : null}

          {!active && !running && !error ? (
            <div className="mt-4 grid gap-3 text-sm text-muted">
              <p>The trace is the loop.</p>
              <p>
                Infer calls the model. Tools are deterministic. Reward is graded against the tool
                log, not the model’s opinion of itself. Train writes a row and hot-loads the
                checkpoint into the next run.
              </p>
            </div>
          ) : null}

          {active ? <TraceView job={active} priorReward={prior?.reward} /> : null}

          {jobs.length > 0 ? (
            <div className="mt-5 border-t border-line pt-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-mono text-xs text-faint">queue</h3>
                <button type="button" onClick={clearJobs} className="min-h-11 px-2 text-xs text-muted">
                  Clear
                </button>
              </div>
              <ul className="mt-1 grid grid-cols-[minmax(0,1fr)] gap-1">
                {jobs.map((job) => {
                  const selected = job.id === active?.id;
                  return (
                    <li key={job.id}>
                      <button
                        type="button"
                        onClick={() => selectJob(job.id)}
                        aria-pressed={selected}
                        className={
                          selected
                            ? "flex min-h-11 w-full items-center gap-3 rounded-lg bg-panel-2 px-3 text-left"
                            : "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left"
                        }
                      >
                        <span className={`w-10 shrink-0 font-mono text-xs tabular-nums ${rewardClass(job.reward)}`}>
                          {job.reward.toFixed(2)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">{job.mission}</span>
                        <span className="shrink-0 font-mono text-xs text-faint">v{job.checkpointVersion}</span>
                        <span className="shrink-0 font-mono text-xs text-faint">{formatWhen(job.at)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </section>

        <LearningCurve checkpoint={checkpoint} />

        <CheckpointPanel checkpoint={checkpoint} onReset={resetCheckpoint} />

        <DatasetPanel checkpoint={checkpoint} />
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-faint md:px-6">
        ScalarLM is public domain. Its contract is generate, then train, then the next generate
        loads the new checkpoint. This bench keeps that contract without a cluster.
      </footer>
    </div>
  );
}

function TraceView({ job, priorReward }: { job: Job; priorReward?: number }) {
  return (
    <div className="mt-4 grid gap-4">
      {priorReward !== undefined ? (
        <p className="text-sm text-muted">
          Same mission last scored{" "}
          <span className="font-mono tabular-nums text-ink">{priorReward.toFixed(2)}</span>. This
          run scored{" "}
          <span className={`font-mono tabular-nums ${rewardClass(job.reward)}`}>
            {job.reward.toFixed(2)}
          </span>
          .
        </p>
      ) : null}
      <ol className="grid gap-3">
        {job.events.map((item, index) => (
          <EventRow key={item.id} event={item} index={index} />
        ))}
      </ol>
      <div>
        <h3 className="font-mono text-xs text-faint">deliverable</h3>
        <p className="mt-2 text-sm whitespace-pre-wrap text-ink">{job.deliverable}</p>
      </div>
      <details className="rounded-lg border border-line bg-canvas px-3 py-2">
        <summary className="min-h-11 cursor-pointer py-2 text-sm text-muted">
          Training row · v{job.checkpointVersion}
        </summary>
        <pre className="overflow-x-auto pb-3 font-mono text-xs whitespace-pre-wrap text-ink">
          {JSON.stringify(job.trainRow)}
        </pre>
      </details>
    </div>
  );
}

function EventRow({ event, index }: { event: TraceEvent; index: number }) {
  return (
    <li className="step-in grid gap-1" style={{ animationDelay: `${index * 40}ms` }}>
      <p className="font-mono text-xs text-faint">{event.title}</p>
      <p className="text-sm whitespace-pre-wrap text-muted">{event.body}</p>
    </li>
  );
}

function presetLabel(id: CheckpointStep["preset"]) {
  return PRESETS.find((item) => item.id === id)?.label ?? id;
}

function curvePoints(checkpoint: Checkpoint) {
  if (checkpoint.history.length) {
    return checkpoint.history.map((step) => ({ version: step.version, reward: step.reward }));
  }
  // Checkpoints from before history was kept only have scores.
  const first = checkpoint.version - checkpoint.scores.length + 1;
  return checkpoint.scores.map((reward, index) => ({ version: first + index, reward }));
}

function LearningCurve({ checkpoint }: { checkpoint: Checkpoint }) {
  const points = curvePoints(checkpoint);
  const width = 640;
  const height = 180;
  const pad = { left: 32, right: 12, top: 12, bottom: 24 };
  const x = (index: number) =>
    points.length === 1
      ? (width + pad.left - pad.right) / 2
      : pad.left + (index / (points.length - 1)) * (width - pad.left - pad.right);
  const y = (reward: number) =>
    pad.top + (1 - Math.min(1, Math.max(0, reward))) * (height - pad.top - pad.bottom);
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(index)},${y(point.reward)}`).join(" ");
  const area = points.length > 1 ? `${path} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z` : "";
  const best = points.reduce((max, point) => Math.max(max, point.reward), 0);
  const delta = points.length > 1 ? points[points.length - 1].reward - points[0].reward : null;

  return (
    <section className="min-w-0 rounded-xl border border-line bg-panel p-4 lg:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-serif text-xl leading-snug">Learning curve</h2>
        {points.length ? (
          <dl className="flex gap-5 font-mono text-xs">
            <div>
              <dt className="text-faint">best</dt>
              <dd className={`tabular-nums ${rewardClass(best)}`}>{best.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-faint">since v{points[0].version}</dt>
              <dd className={`tabular-nums ${delta === null ? "text-ink" : delta > 0 ? "text-good" : delta < 0 ? "text-bad" : "text-ink"}`}>
                {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}`}
              </dd>
            </div>
          </dl>
        ) : null}
      </div>
      {points.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          Train a few epochs on one mission. Each point is a checkpoint, and a weak first run is what
          gives the later ones something to learn from.
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="mt-3 block h-auto w-full text-accent"
          role="img"
          aria-label={`Reward by checkpoint, from ${points[0].reward.toFixed(2)} at v${points[0].version} to ${points[points.length - 1].reward.toFixed(2)} at v${points[points.length - 1].version}`}
        >
          {[0, 0.5, 0.75, 1].map((tick) => (
            <g key={tick}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke="currentColor"
                strokeOpacity={tick === 0.75 ? 0.3 : 0.1}
                strokeDasharray={tick === 0.75 ? "4 4" : undefined}
              />
              <text x={pad.left - 6} y={y(tick) + 4} textAnchor="end" className="fill-faint font-mono text-[10px]">
                {tick.toFixed(2)}
              </text>
            </g>
          ))}
          {area ? <path d={area} fill="currentColor" fillOpacity="0.06" /> : null}
          {points.length > 1 ? <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" /> : null}
          {points.map((point, index) => (
            <g key={point.version}>
              <circle
                cx={x(index)}
                cy={y(point.reward)}
                r="4"
                className={point.reward >= 0.75 ? "fill-good" : point.reward < 0.5 ? "fill-bad" : "fill-ink"}
              >
                <title>{`v${point.version} · ${point.reward.toFixed(2)}`}</title>
              </circle>
              {points.length <= 12 || index % Math.ceil(points.length / 12) === 0 ? (
                <text x={x(index)} y={height - 6} textAnchor="middle" className="fill-faint font-mono text-[10px]">
                  v{point.version}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      )}
    </section>
  );
}

function CheckpointPanel({ checkpoint, onReset }: { checkpoint: Checkpoint; onReset: () => void }) {
  const latest = checkpoint.history[checkpoint.history.length - 1];
  const fresh = new Set(latest?.version === checkpoint.version ? [...latest.added, ...latest.banned] : []);
  const timeline = [...checkpoint.history].reverse().slice(0, 6);

  return (
    <section className="min-w-0 rounded-xl border border-line bg-panel p-4 lg:col-span-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-xl leading-snug">Checkpoint v{checkpoint.version}</h2>
        <button type="button" onClick={onReset} className="min-h-11 px-2 text-xs text-muted">
          Reset
        </button>
      </div>
      <p className="mt-2 text-sm text-muted">
        Inference runs on an OpenAI-compatible endpoint, the same shape ScalarLM serves with vLLM.
        Training here does not touch a GPU. It writes this checkpoint, and the next run reads it.
        Export the dataset to run the real weight update on ScalarLM.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="min-w-0">
          <h3 className="font-mono text-xs text-faint">lessons</h3>
          {checkpoint.lessons.length === 0 ? (
            <p className="mt-2 text-sm text-muted">None yet. A weak run is what writes the first ones.</p>
          ) : (
            <ul className="mt-2 grid gap-2">
              {checkpoint.lessons.map((lesson) => (
                <li key={lesson} className="text-sm text-ink">
                  {fresh.has(lesson) ? <NewTag version={checkpoint.version} /> : null}
                  {lesson}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="font-mono text-xs text-faint">avoid</h3>
          {checkpoint.avoid.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Nothing banned yet.</p>
          ) : (
            <ul className="mt-2 grid gap-2">
              {checkpoint.avoid.map((item) => (
                <li key={item} className="text-sm text-ink">
                  {fresh.has(item) ? <NewTag version={checkpoint.version} /> : null}
                  {item}
                </li>
              ))}
            </ul>
          )}
          {checkpoint.exemplars[0] ? (
            <p className="mt-4 text-xs text-faint">
              {checkpoint.exemplars.length} prior finish
              {checkpoint.exemplars.length === 1 ? "" : "es"} loaded as few-shot.
            </p>
          ) : null}
        </div>
        <div className="min-w-0">
          <h3 className="font-mono text-xs text-faint">diffs</h3>
          {timeline.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Each training step lands here with what it changed.</p>
          ) : (
            <ol className="mt-2 grid gap-2">
              {timeline.map((step) => (
                <li key={step.version} className="grid gap-0.5">
                  <p className="font-mono text-xs text-faint">
                    v{step.version} · <span className={rewardClass(step.reward)}>{step.reward.toFixed(2)}</span> ·{" "}
                    {presetLabel(step.preset)}
                  </p>
                  <p className="text-sm text-muted">
                    {step.added.length || step.banned.length
                      ? [
                          step.added.length ? `+${step.added.length} lesson${step.added.length === 1 ? "" : "s"}` : "",
                          step.banned.length ? `+${step.banned.length} avoid` : "",
                        ]
                          .filter(Boolean)
                          .join(", ")
                      : "No text change. The score still counts."}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}

function NewTag({ version }: { version: number }) {
  return (
    <span className="mr-2 rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-good">new in v{version}</span>
  );
}

const SCALARLM_SNIPPET = `import json
import scalarlm

scalarlm.api_url = "https://your-scalarlm-host"
llm = scalarlm.SupermassiveIntelligence()

with open("scalar-dataset.jsonl") as f:
    dataset = [json.loads(line) for line in f]

status = llm.train(dataset, train_args={"max_steps": 100, "learning_rate": 3e-4})
print(status)`;

function DatasetPanel({ checkpoint }: { checkpoint: Checkpoint }) {
  const rows = checkpoint.dataset;
  const [copied, setCopied] = useState(false);

  function download() {
    const body = rows.map((row) => JSON.stringify({ input: row.prompt, output: row.completion })).join("\n");
    const url = URL.createObjectURL(new Blob([`${body}\n`], { type: "application/jsonl" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "scalar-dataset.jsonl";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(SCALARLM_SNIPPET);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="min-w-0 rounded-xl border border-line bg-panel p-4 lg:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-serif text-xl leading-snug">Dataset</h2>
        <p className="font-mono text-xs text-faint">
          {rows.length} row{rows.length === 1 ? "" : "s"} · dataset.jsonlines
        </p>
      </div>
      <p className="mt-2 text-sm text-muted">
        Every step writes one input/output row: a graded finish, or the lesson a weak run earned.
        That is the shape ScalarLM&apos;s train call takes.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={download}
          disabled={rows.length === 0}
          className="min-h-11 rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          Download .jsonl
        </button>
        <button
          type="button"
          onClick={() => void copy()}
          className="min-h-11 rounded-lg border border-line px-4 text-sm text-ink"
        >
          {copied ? "Copied" : "Copy ScalarLM train script"}
        </button>
      </div>
      {rows.length ? (
        <pre className="mt-4 max-h-48 overflow-auto rounded-lg border border-line bg-canvas p-3 font-mono text-xs whitespace-pre-wrap text-muted">
          {rows
            .slice(-3)
            .map((row) => JSON.stringify({ input: row.prompt, output: row.completion }))
            .join("\n")}
        </pre>
      ) : null}
    </section>
  );
}
