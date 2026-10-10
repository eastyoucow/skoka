# Skoka inference (Python)

Local SAM3 text-prompted instance segmentation and mask overlay.

## Setup

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
```

1. Request access to [`facebook/sam3`](https://huggingface.co/facebook/sam3).
2. Put an approved token in `.env` as `HF_TOKEN=...`.

## Device selection

`INFERENCE_DEVICE` controls where the model runs:

| Value | Behavior |
|-------|----------|
| `auto` (default) | CUDA → MPS → CPU |
| `cuda` | Require CUDA |
| `mps` | Require Apple Metal (Apple Silicon) |
| `cpu` | Force CPU (slow; smoke tests only) |

MPS is intended for local Apple Silicon development. Modal (Phase 2) will use CUDA.

**First MPS run can look “stuck”:** after weights load, SAM3 compiles Metal kernels.
That forward pass may take several minutes with no JSON yet. Progress lines go to
stderr (`[inference HH:MM:SS] ...`). Later runs on the same machine are much faster.
`SAM3_DTYPE=auto` loads float16 on MPS/CUDA to reduce memory and improve speed.

## CLI

```bash
python -m inference.cli --image sample.jpg --prompt person --output result.png
```

Stdout is JSON, e.g. `{"count": 3, "prompt": "person", "device": "mps", ...}`.

Optional flags:

- `--contours` — draw mask outlines
- `--device cuda|mps|cpu|auto` — override env for one run
- `--score-threshold` / `--mask-threshold` — override defaults

## Tests

```bash
# Unit tests only (default; no model download)
pytest

# Real model (skipped unless HF_TOKEN is set and integration is enabled)
INFERENCE_RUN_INTEGRATION=1 pytest -m integration
```

Unit tests never load `facebook/sam3`. Integration tests skip when `HF_TOKEN` is missing or no compatible device is available.
