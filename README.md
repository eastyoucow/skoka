# Skoka

Image object counter: given a photo and a text label, count matching instances and return the image with masks overlaid.

## Repository layout

| Path | Role |
|------|------|
| [`services/inference`](services/inference) | Python SAM3 segmentation (local CLI now; Modal later) |
| [`docs/`](docs) | Architecture plan and prototype reference |

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

## Modal

Do **not** create Modal infrastructure until Phase 2 (after local CLI is reliable).
