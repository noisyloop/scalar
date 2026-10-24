import { create } from "zustand";
import { persist } from "zustand/middleware";
import { EMPTY_CHECKPOINT, nextCheckpoint, normalizeCheckpoint } from "@/lib/scalar/checkpoint";
import { PRESETS, presetById } from "@/lib/scalar/presets";
import type { Checkpoint, Job, LoopSuccess, PresetId } from "@/lib/scalar/types";

type ScalarState = {
  preset: PresetId;
  mission: string;
  artifact: string;
  checkpoint: Checkpoint;
  jobs: Job[];
  activeJobId: string | null;
  setMission: (mission: string) => void;
  setArtifact: (artifact: string) => void;
  setPreset: (preset: PresetId) => void;
  selectJob: (id: string) => void;
  commit: (result: LoopSuccess, run: { preset: PresetId; mission: string; epoch: number }) => void;
  resetCheckpoint: () => void;
  clearJobs: () => void;
};

const initial = presetById("review");

export const useScalar = create<ScalarState>()(
  persist(
    (set, get) => ({
      preset: initial.id,
      mission: initial.mission,
      artifact: initial.artifact,
      checkpoint: EMPTY_CHECKPOINT,
      jobs: [],
      activeJobId: null,
      setMission: (mission) => set({ mission }),
      setArtifact: (artifact) => set({ artifact }),
      setPreset: (preset) => {
        const next = presetById(preset);
        set({ preset, mission: next.mission, artifact: next.artifact, activeJobId: null });
      },
      selectJob: (id) => set({ activeJobId: id }),
      // `run` is what was sent, so editing the form mid-run cannot mislabel the job.
      commit: (result, run) => {
        const current = get();
        const at = Date.now();
        const checkpoint = nextCheckpoint(current.checkpoint, {
          reward: result.reward,
          lessons: result.lessons,
          avoid: result.avoid,
          exemplar: result.exemplar,
          trainRow: result.trainRow,
          preset: run.preset,
          at,
        });
        const job: Job = {
          id: crypto.randomUUID(),
          at,
          preset: run.preset,
          mission: run.mission,
          epoch: run.epoch,
          reward: result.reward,
          rubric: result.rubric,
          deliverable: result.deliverable,
          events: result.events,
          trainRow: result.trainRow,
          checkpointVersion: checkpoint.version,
        };
        set({
          checkpoint,
          jobs: [job, ...current.jobs].slice(0, 12),
          activeJobId: job.id,
        });
      },
      resetCheckpoint: () => set({ checkpoint: EMPTY_CHECKPOINT }),
      clearJobs: () => set({ jobs: [], activeJobId: null }),
    }),
    {
      name: "scalar-loop",
      skipHydration: true,
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<ScalarState>;
        return { ...current, ...saved, checkpoint: normalizeCheckpoint(saved.checkpoint) };
      },
      partialize: (state) => ({
        preset: state.preset,
        mission: state.mission,
        artifact: state.artifact,
        checkpoint: state.checkpoint,
        jobs: state.jobs,
        activeJobId: state.activeJobId,
      }),
    },
  ),
);

export { PRESETS };
