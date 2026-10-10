# Skoka

Image object counter: given a photo and a text label, count matching instances and return the image with masks overlaid.

## Current status

**Phase 1 complete** — local Python SAM3 inference in [`services/inference`](services/inference).  
**Next:** Phase 2 — deploy inference to Modal (R2 I/O + callbacks). Create Modal infrastructure at the start of Phase 2.

Handoff for the next agent: [`docs/PHASE_1.md`](docs/PHASE_1.md) (what shipped, decisions, contracts, limitations, Phase 2 prerequisites).  
Full phased plan: [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).

## Repository layout

| Path | Role |
|------|------|
| [`services/inference`](services/inference) | Python SAM3 segmentation (local CLI; Modal next) |
| [`docs/`](docs) | Architecture plan, Phase 1 handoff, prototype spike |

NestJS API and Next.js web app will live under `apps/` later and deploy independently. Each service keeps its own `.env.example`.

## Quick start (Phase 1 — local inference)

```bash
cd services/inference
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
# Set HF_TOKEN after accepting facebook/sam3 terms on Hugging Face
pytest
python -m inference.cli --image path/to/sample.jpg --prompt person --output /tmp/result.png
```

See [`services/inference/README.md`](services/inference/README.md) for device selection, tests, and configuration.
