# Skoka

Image object counter: given a photo and a text label, count matching instances and return the image with masks overlaid.

## Current status

**Phase 5 complete (code)** — Telegram delivery loop, Render Blueprint + prod Docker image, rate limit, structured metrics logs.  
**Next:** Apply Render secrets + webhook cutover (ops checklist in [`docs/PHASE_5.md`](docs/PHASE_5.md)), then Phase 6 (Next.js) when ready.

Read handoffs **before** starting the next phase:

1. [`docs/PHASE_5.md`](docs/PHASE_5.md) — delivery, Render deploy, ops checklist  
2. [`docs/PHASE_4.md`](docs/PHASE_4.md) — Telegram → Modal → callbacks  
3. [`docs/PHASE_3.md`](docs/PHASE_3.md) — Nest layout, migrations, Supabase pooler, R2  
4. [`docs/PHASE_2.md`](docs/PHASE_2.md) — Modal `skoka-inference` / `run_job`, callback HMAC  
5. [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — full phased plan  

## Repository layout

| Path | Role |
|------|------|
| [`apps/api`](apps/api) | NestJS API (Telegram, jobs, Modal, delivery) |
| [`services/inference`](services/inference) | Python SAM3 (local CLI + Modal) |
| [`docs/`](docs) | Architecture plan and phase handoffs |
| [`docker-compose.yml`](docker-compose.yml) | Local API + Postgres 17 |
| [`render.yaml`](render.yaml) | Render Blueprint (always-on API) |

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

Details: [`apps/api/README.md`](apps/api/README.md) and [`docs/PHASE_5.md`](docs/PHASE_5.md).

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

## Production (Render)

See [`docs/PHASE_5.md`](docs/PHASE_5.md) and [`render.yaml`](render.yaml). Use a **paid always-on** instance so dispatcher/delivery/recovery keep running.
