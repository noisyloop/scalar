export type PresetId = "review" | "threat" | "plan" | "harmony";

export type Exemplar = {
  prompt: string;
  completion: string;
};

export type CheckpointStep = {
  version: number;
  at: number;
  reward: number;
  preset: PresetId;
  added: string[];
  banned: string[];
};

export type Checkpoint = {
  version: number;
  updatedAt: number | null;
  lessons: string[];
  avoid: string[];
  exemplars: Exemplar[];
  scores: number[];
  history: CheckpointStep[];
  dataset: Exemplar[];
};

export type TracePhase = "infer" | "tool" | "reward" | "train";

export type TraceEvent = {
  id: string;
  phase: TracePhase;
  title: string;
  body: string;
};

export type Job = {
  id: string;
  at: number;
  preset: PresetId;
  mission: string;
  epoch?: number;
  reward: number;
  rubric: string;
  deliverable: string;
  events: TraceEvent[];
  trainRow: Exemplar;
  checkpointVersion: number;
};

export type LoopRequest = {
  preset: PresetId;
  mission: string;
  artifact: string;
  checkpoint: {
    version: number;
    lessons: string[];
    avoid: string[];
    exemplars: Exemplar[];
  };
};

export type LoopSuccess = {
  ok: true;
  model: string;
  deliverable: string;
  events: TraceEvent[];
  reward: number;
  rubric: string;
  lessons: string[];
  avoid: string[];
  exemplar: Exemplar | null;
  trainRow: Exemplar;
};

export type LoopResult = LoopSuccess | { ok: false; error: string };
