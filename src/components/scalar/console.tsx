import { useEffect, useState, type KeyboardEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { runClosedLoop } from "@/lib/scalar/api";
import { PRESETS, useScalar } from "@/lib/scalar/store";
import type { Job, TraceEvent } from "@/lib/scalar/types";

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
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void useScalar.persist.rehydrate();
  }, []);

  const active = jobs.find((job) => job.id === activeJobId) ?? null;
  const prior =
    active && jobs[0]?.id === active.id
      ? jobs.slice(1).find((job) => job.mission === active.mission)
      : undefined;
  const presetMeta = PRESETS.find((item) => item.id === preset) ?? PRESETS[0];

  async function onRun() {
    if (running || !mission.trim()) return;
    setRunning(true);
    setError(null);
    try {
      const result = await run({
        data: {
          preset,
          mission: mission.trim(),
          artifact,
          checkpoint: {
            version: checkpoint.version,
            lessons: checkpoint.lessons,
            avoid: checkpoint.avoid,
            exemplars: checkpoint.exemplars,
          },
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      commit(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The loop failed.");
    } finally {
      setRunning(false);
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

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="submit"
                disabled={running || mission.trim().length === 0}
                className="min-h-11 rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink disabled:opacity-50"
              >
                {running ? "Running the loop" : "Run closed loop"}
              </button>
              <p className="text-xs text-faint">
                {checkpoint.version > 0
                  ? `Checkpoint v${checkpoint.version} is loaded into this run.`
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
            <p className="mt-4 text-sm text-muted">Infer, then tools, then reward, then train.</p>
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
              <ul className="mt-1 grid gap-1">
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
                        <span className="shrink-0 font-mono text-xs text-faint">{formatWhen(job.at)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="min-w-0 rounded-xl border border-line bg-panel p-4 lg:col-span-2">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-serif text-xl leading-snug">Checkpoint</h2>
            <button type="button" onClick={resetCheckpoint} className="min-h-11 px-2 text-xs text-muted">
              Reset
            </button>
          </div>
          <p className="mt-2 text-sm text-muted">
            Inference is Grok on an OpenAI-compatible endpoint, the same shape ScalarLM serves with
            vLLM. Training does not touch a GPU. It writes this checkpoint, and the next run reads
            it.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="font-mono text-xs text-faint">lessons</h3>
              {checkpoint.lessons.length === 0 ? (
                <p className="mt-2 text-sm text-muted">None yet. A weak run is what writes the first ones.</p>
              ) : (
                <ul className="mt-2 grid gap-2">
                  {checkpoint.lessons.map((lesson) => (
                    <li key={lesson} className="text-sm text-ink">
                      {lesson}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="font-mono text-xs text-faint">avoid</h3>
              {checkpoint.avoid.length === 0 ? (
                <p className="mt-2 text-sm text-muted">Nothing banned yet.</p>
              ) : (
                <ul className="mt-2 grid gap-2">
                  {checkpoint.avoid.map((item) => (
                    <li key={item} className="text-sm text-ink">
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
          </div>
        </section>
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
