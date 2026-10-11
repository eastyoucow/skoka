# Skoka API (NestJS)

Phase 5: Postgres (TypeORM), Cloudflare R2, Telegram webhook + **result delivery**, Modal dispatch, signed callbacks, recovery, Render prod image.

Handoff: [`docs/PHASE_5.md`](../../docs/PHASE_5.md).  
Prior: [`docs/PHASE_4.md`](../../docs/PHASE_4.md), [`docs/PHASE_2.md`](../../docs/PHASE_2.md).

## Setup

```bash
cd apps/api
cp .env.example .env
# Fill R2_*, CALLBACK_SHARED_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET,
# PUBLIC_BASE_URL (HTTPS tunnel or Render URL), and MODAL_TOKEN_* for Docker/prod
npm ci
npm run start:dev
```

### Local with Docker

From repo root:

```bash
cp apps/api/.env.example apps/api/.env   # once; add secrets
docker compose up --build
```

Compose uses the **dev** `Dockerfile` (hot reload). Production uses `Dockerfile.prod` via [`render.yaml`](../../render.yaml).

Modal JS SDK needs `MODAL_TOKEN_ID` + `MODAL_TOKEN_SECRET` inside the container (host `~/.modal.toml` is not mounted by default).

- API: http://localhost:3000  
- Postgres 17: `localhost:5432` (user/password/db: `skoka`)  

### Telegram webhook

```bash
# PUBLIC_BASE_URL must be HTTPS reachable by Telegram (and by Modal for callbacks)
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=${PUBLIC_BASE_URL}/webhooks/telegram" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

UX: send a photo; optional caption is the label (default `person`). After processing you receive the masked result photo + count (or a short failure message).

### Render

See [`docs/PHASE_5.md`](../../docs/PHASE_5.md). Blueprint: [`render.yaml`](../../render.yaml). Image: `Dockerfile.prod`.

### Dependency pins (do not casually bump)

| Package | Pin | Why |
|---------|-----|-----|
| `typeorm` | `0.3.27` | Nest 11 + current migration tooling |
| `@nestjs/config` | `4.0.2` | v12 is ESM-only → `ERR_REQUIRE_ESM` under CJS Nest build |
| `@nestjs/typeorm` | `11.0.0` | Matches TypeORM 0.3 |
| `modal` | `^0.11` | Official JS SDK for `spawn` |

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness |
| GET | `/health/ready` | Postgres ready |
| GET | `/health/storage` | R2 probe (non-gating) |
| POST | `/api/jobs` | multipart create (dev/foundation) |
| GET | `/api/jobs/:id` | Job by id |
| POST | `/webhooks/telegram` | Telegram updates (rate-limited) |
| POST | `/internal/jobs/:id/complete` | Modal success callback |
| POST | `/internal/jobs/:id/fail` | Modal failure callback |

## Tests

```bash
npm test
# stop Compose API first if DB e2e races live pollers
API_RUN_DB_E2E=1 npm run test:e2e
```

## Layout

```
src/
  config/           env + validation
  common/           rate-limit guard
  database/         TypeORM options, CLI DataSource
  jobs/             entities, repository, create/get API
  telegram/         webhook + Bot API client (sendPhoto)
  modal/            Modal spawn client
  orchestration/    dispatcher + recovery + delivery loops
  internal/         HMAC callback receivers
  storage/          R2 adapter + image validation
  health/
  migrations/
```
