# Skoka

Image object counter: given a photo and a text label, count matching instances and return the image with masks overlaid.

## Current status

**Phase 3 complete** — NestJS API + TypeORM migrations + Supabase/Compose Postgres + R2 input upload; jobs reach **`QUEUED`**.  
**Next:** Phase 4 — Telegram webhook, Modal dispatch, signed callbacks, recovery.

Read handoffs **before** starting the next phase (new agent should start here):

1. [`docs/PHASE_3.md`](docs/PHASE_3.md) — Nest layout, migrations, Supabase pooler, decisions, Phase 4 checklist  
2. [`docs/PHASE_2.md`](docs/PHASE_2.md) — Modal `skoka-inference` / `run_job`, callback HMAC, R2 keys  
3. [`docs/PHASE_1.md`](docs/PHASE_1.md) — local SAM3 library  
4. [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — full phased plan  

## Repository layout

| Path | Role |
|------|------|
| [`apps/api`](apps/api) | NestJS API (jobs, TypeORM, R2) |
| [`services/inference`](services/inference) | Python SAM3 (local CLI + Modal) |
| [`docs/`](docs) | Architecture plan and phase handoffs |
| [`docker-compose.yml`](docker-compose.yml) | Local API + Postgres 17 |

**Secrets:** never commit `.env` / `.env.modal`. Use each service’s `.env.example`.

## Quick start (API)

```bash
cp apps/api/.env.example apps/api/.env
# Set R2_* (and optionally Supabase DATABASE_* — see docs/PHASE_3.md)

# Option A — host Nest + Supabase or local Postgres
cd apps/api && npm ci && npm run start:dev

# Option B — Docker (Compose Postgres; overrides DATABASE_HOST=postgres)
docker compose up --build
```

Smoke create (multipart `file` + fields):

```bash
curl -s -X POST http://localhost:3000/api/jobs \
  -F prompt=person -F source=web -F externalRequestId=demo-1 \
  -F channel=web -F recipientId=local -F file=@./sample.jpg
```

Details: [`apps/api/README.md`](apps/api/README.md).

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

## Modal (Phase 2)

See [`docs/PHASE_2.md`](docs/PHASE_2.md) and [`services/inference/README.md`](services/inference/README.md).
