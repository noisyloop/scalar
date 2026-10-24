# Scalar

An agent that trains on its own trace. The next inference loads the checkpoint. Built around the
generate → train → generate contract of [ScalarLM](https://github.com/tensorwavecloud/ScalarLM).

Each epoch is one closed loop:

1. **Infer.** The model works a mission with deterministic tools (`scan_artifact`, `arithmetic`,
   `music_check`, `regex_scan`).
2. **Reward.** The run is graded against the tool log, so it can't grade itself up. Findings the
   scan reported, arithmetic results and the substitution `music_check` found have to show up in
   the answer.
3. **Train.** Lessons, banned phrasings and a training row are written into a new checkpoint
   version. The next epoch hot-loads it.

Pick ×3 or ×5 epochs to watch the learning curve climb. Each version's diff (lessons added,
phrasings banned) is listed, and the accumulated rows download as `scalar-dataset.jsonl`
(`{"input", "output"}` per line). The app also gives you a script that sends that file to
ScalarLM's `train` call for a real weight update.

## Model endpoint

Any OpenAI-compatible chat endpoint works, including a ScalarLM deployment:

| Variable              | Default                 |
| --------------------- | ----------------------- |
| `SCALAR_LLM_BASE_URL` | `https://api.x.ai/v1`   |
| `SCALAR_LLM_MODEL`    | `grok-4.5`              |
| `SCALAR_LLM_API_KEY`  | falls back to `XAI_API_KEY` |

## Develop

```sh
npm install
npm run dev        # http://localhost:8080
npm run typecheck
npm run build
```
