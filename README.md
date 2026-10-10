# Skoka

Image object counter: given a photo and a text label, count matching instances and return the image with masks overlaid.

## Current status

**Phase 2 complete** — Modal worker, R2 I/O, and signed callback client in [`services/inference`](services/inference).  
NestJS callback endpoints are Phase 4 (Option B: client + mocked tests only).  
**Next:** Phase 3 — NestJS + Postgres + local Docker Compose (Python stays out of Compose).

Handoffs (read these before starting the next phase):

- Phase 1 (local SAM3 library): [`docs/PHASE_1.md`](docs/PHASE_1.md)
- Phase 2 (Modal + R2 + callbacks + decisions): [`docs/PHASE_2.md`](docs/PHASE_2.md)
- Full phased plan: [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)

## Repository layout

| Path | Role |
|------|------|
| [`services/inference`](services/inference) | Python SAM3 (local CLI + Modal deploy) |
| [`docs/`](docs) | Architecture plan and phase handoffs |

NestJS API and Next.js will live under `apps/` later. Local Docker Compose (NestJS + Postgres 17) ships in Phase 3 — see the plan section **Local Docker development**. Each service keeps its own `.env.example`.

**Secrets:** never commit `.env` or `.env.modal` (gitignored). Use `.env.example` as the template only.

## Quick start (local inference)

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

## Modal (Phase 2)

Cloud checklist and contracts: [`docs/PHASE_2.md`](docs/PHASE_2.md).

```bash
cd services/inference
source .venv/bin/activate
pip install -e ".[deploy]"   # or .[dev]
modal setup                  # once
cp .env.example .env.modal   # fill HF / R2 / CALLBACK_SHARED_SECRET
modal secret create skoka-dev --from-dotenv .env.modal --force
modal deploy -m inference.modal_app
```

See [`services/inference/README.md`](services/inference/README.md) for device selection, tests, and smoke commands.
