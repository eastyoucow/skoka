# Skoka

Image object counter: given a photo and a text label, count matching instances and return the image with masks overlaid.

## Current status

**Phase 4 complete** — Telegram webhook, Modal dispatch, signed callbacks, lease recovery; jobs can reach **`COMPLETED`** (verified with ngrok locally). Result photo is **not** sent yet.  
**Next:** Phase 5 — Telegram delivery loop, Render deploy, hardening. Start at [`docs/PHASE_4.md`](docs/PHASE_4.md).

Read handoffs **before** starting the next phase:

1. [`docs/PHASE_4.md`](docs/PHASE_4.md) — decisions, delivery contract, Phase 5 checklist, ngrok/Modal callback notes  
2. [`docs/PHASE_3.md`](docs/PHASE_3.md) — Nest layout, migrations, Supabase pooler, R2  
3. [`docs/PHASE_2.md`](docs/PHASE_2.md) — Modal `skoka-inference` / `run_job`, callback HMAC  
4. [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — full phased plan  

## Repository layout

| Path | Role |
|------|------|
| [`apps/api`](apps/api) | NestJS API (Telegram, jobs, Modal dispatch, callbacks) |
| [`services/inference`](services/inference) | Python SAM3 (local CLI + Modal) |
| [`docs/`](docs) | Architecture plan and phase handoffs |
| [`docker-compose.yml`](docker-compose.yml) | Local API + Postgres 17 |

**Secrets:** never commit `.env` / `.env.modal`. Use each service’s `.env.example`.

## Quick start (API)

```bash
cp apps/api/.env.example apps/api/.env
# Set R2_*, CALLBACK_SHARED_SECRET, TELEGRAM_*, PUBLIC_BASE_URL, MODAL_TOKEN_* (Docker)

# Option A — host Nest + Supabase or local Postgres
cd apps/api && npm ci && npm run start:dev

# Option B — Docker (Compose Postgres; overrides DATABASE_HOST=postgres)
docker compose up --build
```

Details: [`apps/api/README.md`](apps/api/README.md) and [`docs/PHASE_4.md`](docs/PHASE_4.md).

## Quick start (local inference)

```bash
cd services/inference
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
pytest
python -m inference.cli --image path/to/sample.jpg --prompt person --output /tmp/result.png
```

## Modal

See [`docs/PHASE_2.md`](docs/PHASE_2.md) and [`services/inference/README.md`](services/inference/README.md).
