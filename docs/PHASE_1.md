# Phase 1 — Local Python SAM3 Inference (handoff)

Status: **complete** (Phase 2 Modal handoff is in [`PHASE_2.md`](PHASE_2.md)). Local CLI can load gated `facebook/sam3`, run text-prompted instance segmentation, write an overlay image, and print JSON count metadata.

Prototype reference (not the runtime entrypoint): [`docs/main.py`](main.py).  
Full product plan: [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).

---

## What was implemented

### Repository shape

```
skoka/
├── README.md
├── .gitignore
├── docs/
│   ├── IMPLEMENTATION_PLAN.md
│   ├── PHASE_1.md              ← this file
│   └── main.py                 # early spike; keep for reference
└── services/
    └── inference/              # standalone Python package (deploy unit for Modal)
        ├── pyproject.toml
        ├── .env.example
        ├── README.md
        ├── src/inference/
        │   ├── device.py       # CUDA → MPS → CPU (+ explicit override)
        │   ├── config.py       # dotenv-backed InferenceConfig
        │   ├── model.py        # lazy Sam3Model/Sam3Processor cache + dtype
        │   ├── segment.py      # segment(image, prompt) → SegmentationResult
        │   ├── render.py       # render(image, masks) → RGB overlay
        │   ├── logging_util.py # stderr progress lines
        │   ├── cli.py          # python -m inference.cli
        │   └── __main__.py
        └── tests/              # unit + optional @pytest.mark.integration
```

No NestJS/`apps/` scaffolding yet. No Modal, R2, or boto3 in this phase.

### Core capabilities

| Piece | Behavior |
|-------|----------|
| `segment(image, prompt)` | Loads RGB image; runs SAM3; returns masks, scores, boxes, `count`, device, model id. Empty prompt / corrupt image raise clear errors. Zero detections → `count=0`. |
| `render(image, masks)` | Per-instance semi-transparent color overlays; optional contours; resizes mismatched masks to image size; empty masks → RGB copy. |
| CLI | `--image` / `--prompt` / `--output` (+ `--device`, `--contours`, thresholds). Progress on **stderr**; result JSON on **stdout**. Exit `2` bad image, `1` inference error, `0` success. |
| Device | `INFERENCE_DEVICE`: `auto` (CUDA→MPS→CPU) or explicit `cuda`/`mps`/`cpu`. |
| Dtype | `SAM3_DTYPE`: `auto` → float16 on CUDA/MPS, float32 on CPU. |
| Tests | Default `pytest` = unit only (mocked model, no HF download). Integration marked and skipped unless `INFERENCE_RUN_INTEGRATION=1` + `HF_TOKEN` + usable device. |

### Verified locally

- Package install on Python 3.12 with pinned deps including **torchvision** (required by `Sam3ImageProcessor`).
- Unit tests: **25 passed** (integration deselected by default).
- Real CLI run against a local photo completed and wrote an overlay (`services/inference/tmp/result.png` locally; not committed).
- First MPS forward after weight load can take **several minutes** (Metal kernel compile); later runs are faster. Progress logs were added so this does not look hung.

---

## Key architecture decisions and rationale

1. **`services/inference` as an independent deployable, not a shared monorepo tool**  
   Python (Modal) and NestJS (Render) deploy separately. No Nx/pnpm/workspace coupling. Each app/service owns its own `.env.example`.

2. **Minimal Phase 0 only**  
   Root README + `.gitignore` + inference package. Empty `apps/` directories and NestJS scaffold deferred — avoid fake structure Phase 2/3 will reshape.

3. **Split `segment` / `render` / CLI**  
   Modal workers should call library functions, not shell out to CLI. Overlay policy stays independent of model I/O.

4. **Lazy model cache in-process**  
   `load_model()` caches `Sam3Model` + `Sam3Processor` per `(model_id, device, dtype)`. Matches Modal “load once per warm container” intent.

5. **Device + dtype configurable via env**  
   Local Apple Silicon uses MPS + float16; Modal will force CUDA. CPU remains a fallback for smoke tests only.

6. **Service-local env files**  
   `services/inference/.env` only. Never a shared root `.env` (secrets blast radius / independent deploys).

7. **Gated HF model via Transformers**  
   `facebook/sam3` through `Sam3Model` / `Sam3Processor` (`transformers==5.19.0`), consistent with the spike. Requires HF access approval + `HF_TOKEN`.

8. **Default thresholds from the spike**  
   Score `0.35`, mask `0.5` — not yet tuned against a quality set.

9. **Overlays without boxes by default**  
   Distinct per-instance colors + optional contours. Prototype bounding boxes were dropped from the default UX to keep rendering simple.

10. **stderr progress vs stdout JSON**  
    Long MPS/CUDA runs need human-visible progress without breaking machine-readable CLI output for future automation.

---

## Important API contracts and dependencies

### Python library contract (stable for Phase 2)

```python
from inference import segment, render
from inference.segment import SegmentationResult, ImageLoadError

result: SegmentationResult = segment(image, prompt)  # path | PIL.Image
# result.count, .masks, .scores, .boxes, .prompt, .device, .model_id

overlay_rgb = render(image, result.masks, contours=False)  # PIL RGB
```

`SegmentationResult` fields:

| Field | Meaning |
|-------|---------|
| `count` | `len(masks)` after processor post-process + thresholds |
| `masks` | Instance masks (tensors/arrays), sized to original image when post-process succeeds |
| `scores` | Per-instance floats |
| `boxes` | Present from processor; not used by default render |
| `prompt` | Stripped text prompt |
| `device` | Torch device string used for the run |
| `model_id` | HF id (default `facebook/sam3`) |

### CLI contract

```bash
python -m inference.cli --image PATH --prompt TEXT --output PATH
```

Stdout (success):

```json
{
  "count": 3,
  "prompt": "person",
  "device": "mps",
  "model_id": "facebook/sam3",
  "scores": [0.9, ...],
  "output": "/tmp/result.png",
  "elapsed_ms": 12345.6
}
```

Stderr: `[inference HH:MM:SS] ...` progress. Errors: JSON `{"error": "..."}` on stderr with non-zero exit.

### Environment variables (`services/inference/.env`)

| Variable | Default | Notes |
|----------|---------|-------|
| `HF_TOKEN` | (required for real model) | Gated model access |
| `INFERENCE_DEVICE` | `auto` | `auto` \| `cuda` \| `mps` \| `cpu` |
| `SAM3_DTYPE` | `auto` | `auto` \| `float16` \| `float32` \| `bfloat16` |
| `SAM3_MODEL_ID` | `facebook/sam3` | |
| `SAM3_SCORE_THRESHOLD` | `0.35` | Passed to `post_process_instance_segmentation` |
| `SAM3_MASK_THRESHOLD` | `0.5` | |
| `INFERENCE_RUN_INTEGRATION` | unset | Set `1` to allow real-model pytest |

### Pinned runtime dependencies

From [`services/inference/pyproject.toml`](../services/inference/pyproject.toml):

- Python `>=3.12`
- `torch==2.14.1`
- `torchvision==0.29.1` (**required** — without it `Sam3ImageProcessor` fails at import/runtime)
- `transformers==5.19.0` (provides `Sam3Model` / `Sam3Processor`)
- `Pillow==11.3.0`, `numpy==2.5.3`, `python-dotenv==1.2.4`
- Dev: `pytest==8.4.2`

### Not implemented here (Phase 2+ contracts from the plan)

These are **planned**, not coded yet — NestJS will eventually send something like:

```text
{ jobId, attemptId, inputKey, prompt, outputKey, callbackUrl }
```

Phase 1 has no job/attempt IDs, no R2 keys, no callbacks. Modal wrapper should call `segment` + `render`, then upload and callback.

---

## Known limitations and technical debt

1. **Local latency / MPS** — First warm-up on Apple Silicon is very slow; MacBook Air is not a production inference target. No formal latency/VRAM benchmark table yet (only ad-hoc CLI `elapsed_ms` and optional integration RSS print).
2. **No image size / format policy** — CLI accepts whatever Pillow opens; no max dimension, no EXIF orientation policy, no HEIC handling. Product limits still TBD (Phase 0 leftovers).
3. **Thresholds / quality untuned** — Defaults copied from the spike; no size/confidence filtering beyond SAM3 post-process thresholds; no regression fixtures with expected counts.
4. **Boxes unused in render** — Returned but not drawn; contours are a simple morphological approx, not model polygons.
5. **Model load API** — Uses Transformers `dtype=` on `from_pretrained`; watch for Transformers API drift. Deprecation warning seen: `memory_attention_rope_theta` from upstream config.
6. **Secrets / ops** — HF token only in local `.env` (gitignored). No Modal secret wiring yet. No CI. No lint/format toolchain pinned beyond pytest.
7. **Phase 0 incomplete** — Telegram UX, retry/timeout policy, callback auth design, budget caps, and typed cross-service schema are still open (see plan “Open decisions”).
8. **Integration test is weak** — Synthetic fixture; does not assert a known person count. Real photo assets must stay out of git.
9. **Egg-info / editable install artifacts** — Local `.venv` and `*.egg-info` are gitignored; fresh clone needs `pip install -e ".[dev]"`.

---

## What Phase 2 needs to know about Phase 1

### Reuse as-is

- Call **`segment` + `render`** inside the Modal function; do not reinvent post-process or overlay logic in the worker.
- Keep the package installable from `services/inference` with the same pinned deps (+ add `modal`, `boto3` in Phase 2).
- **Load the model once per warm container** (same idea as `load_model()` cache); set `min_containers=0`, CUDA device, float16 (or benchmark bf16 on chosen GPU).
- Pass **`HF_TOKEN`** (or HF hub secret) into the Modal image/runtime — model is gated.
- Treat **`count` = number of instance masks** after thresholds as the product metric NestJS will store.

### Do not assume

- Do not assume 60s end-to-end from local MPS timings.
- Do not assume CLI JSON is the NestJS contract — define Modal payload + NestJS callback shapes in Phase 2 (plan draft: job/attempt/keys/callbackUrl).
- Do not commit user images or `.env`; use R2 keys and Modal secrets.
- Do not pull NestJS into this package; orchestration stays outside inference.

### Suggested Phase 2 entry checklist

1. Create Modal account/app and wire HF + R2 secrets (now is the right time for Modal infra).
2. Build image from `services/inference` pins + CUDA torch/torchvision wheels matching the GPU image.
3. Modal function: download `inputKey` → `segment` → `render` → upload `outputKey` → signed callback `{attemptId, count, outputKey}` / fail path.
4. Benchmark cold vs warm on one GPU SKU; set timeout/memory/`max_containers`.
5. Document measured latency/cost before Phase 3 NestJS dispatch.

### Pointers for the next agent

| Doc / path | Why |
|------------|-----|
| [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) § Phase 2 | Scope and done-when criteria |
| [`services/inference/README.md`](../services/inference/README.md) | Local setup, device, tests |
| [`services/inference/src/inference/segment.py`](../services/inference/src/inference/segment.py) | Library entry for Modal |
| [`services/inference/src/inference/render.py`](../services/inference/src/inference/render.py) | Overlay entry for Modal |
| [`services/inference/pyproject.toml`](../services/inference/pyproject.toml) | Pins to mirror in Modal image |

**Modal infrastructure:** create at the start of Phase 2 (not before). Phase 1 deliberately stopped before any Modal/R2 code.
