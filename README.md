# Skoka

Image object counter: given a photo and a text label, count matching instances and return the image with masks overlaid.

## Current status

**Phase 6 in progress (code)** — Next.js static SPA + Nest `/web/*` with Bearer sessions and presigned R2 uploads.  
Ops: set `CORS_ORIGINS` on API, configure R2 CORS, deploy Static Site `skoka-ui` (see [`docs/PHASE_6.md`](docs/PHASE_6.md)).

Read handoffs:

1. [`docs/PHASE_6.md`](docs/PHASE_6.md) — web demo, sessions, Render UI settings  
2. [`docs/PHASE_5.md`](docs/PHASE_5.md) — delivery, Render API deploy  
3. [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — full phased plan  

## Repository layout

| Path | Role |
|------|------|
| [`apps/api`](apps/api) | NestJS API (Telegram, jobs, Modal, delivery, `/web/*`) |
| [`apps/web`](apps/web) | Next.js static SPA (Render Static Site `skoka-ui`) |
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

## Quick start (web UI)

```bash
# API must allow CORS for the UI origin
# apps/api/.env → CORS_ORIGINS=http://localhost:3001

cd apps/web
cp .env.example .env.local
npm ci && npm run dev   # http://localhost:3001
```

See [`apps/web/README.md`](apps/web/README.md) and [`docs/PHASE_6.md`](docs/PHASE_6.md).

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

- **API** Web Service `skoka` → `https://skoka.onrender.com` — [`docs/PHASE_5.md`](docs/PHASE_5.md), [`render.yaml`](render.yaml). Paid always-on.
- **UI** Static Site `skoka-ui` → `https://skoka-ui.onrender.com` — root `apps/web`, publish `out`, `NEXT_PUBLIC_API_URL=https://skoka.onrender.com`.
