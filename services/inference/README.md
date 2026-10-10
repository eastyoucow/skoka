# Skoka inference (Python)

Local SAM3 text-prompted instance segmentation and mask overlay, plus Modal deployment with Cloudflare R2 I/O and a signed NestJS callback client.

- Phase 1 handoff: [`docs/PHASE_1.md`](../../docs/PHASE_1.md)
- Phase 2 handoff (Modal, R2, callback contract): [`docs/PHASE_2.md`](../../docs/PHASE_2.md)

Python/SAM3 is **not** Dockerized. Local Docker Compose for NestJS + Postgres arrives in Phase 3.

## Setup

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
```

1. Request access to [`facebook/sam3`](https://huggingface.co/facebook/sam3).
2. Put an approved token in `.env` as `HF_TOKEN=...`.
3. For Modal/R2: fill `R2_*` and `CALLBACK_SHARED_SECRET` (see `.env.example` and Phase 2 checklist). Never commit real values.

## Device selection

`INFERENCE_DEVICE` controls where the model runs locally:

| Value | Behavior |
|-------|----------|
| `auto` (default) | CUDA → MPS → CPU |
| `cuda` | Require CUDA |
| `mps` | Require Apple Metal (Apple Silicon) |
| `cpu` | Force CPU (slow; smoke tests only) |

Modal workers force CUDA + float16 via image env.

**First MPS run can look “stuck”:** after weights load, SAM3 compiles Metal kernels.
Progress lines go to stderr (`[inference HH:MM:SS] ...`).

## CLI (local)

```bash
python -m inference.cli --image sample.jpg --prompt person --output result.png
```

Stdout is JSON, e.g. `{"count": 3, "prompt": "person", "device": "mps", ...}`.

## Modal

App: `skoka-inference` · Function: `run_job`

Create Modal Secret `skoka-dev` from gitignored `.env.modal` (same keys as `.env.example`):

```bash
modal setup
modal secret create skoka-dev --from-dotenv .env.modal
modal deploy -m inference.modal_app

# After uploading an input object to R2:
modal run -m inference.modal_app \
  --input-key jobs/smoke/input.jpg \
  --prompt person \
  --callback-url https://example.invalid
```

NestJS will later call `modal.Function.from_name("skoka-inference", "run_job").spawn(payload)`.  
Callback HTTP is mocked in unit tests until Phase 4; see [`docs/PHASE_2.md`](../../docs/PHASE_2.md) for the contract.

## Library usage (Modal / NestJS workers)

```python
from inference import segment, render
from inference.job import run_job  # R2 + segment + render + callback
```

## Tests

```bash
# Unit tests only (default; no model download, no live R2/HTTP)
pytest

# Real model (skipped unless HF_TOKEN is set and integration is enabled)
INFERENCE_RUN_INTEGRATION=1 pytest -m integration
```

Unit tests never load `facebook/sam3` and never call a real NestJS server.
