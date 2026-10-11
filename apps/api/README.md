# Skoka API (NestJS)

Phase 4: Postgres (TypeORM), Cloudflare R2, Telegram webhook, Modal dispatch, signed callbacks, recovery loops.

Handoff: [`docs/PHASE_4.md`](../../docs/PHASE_4.md).  
Modal / callback contracts: [`docs/PHASE_2.md`](../../docs/PHASE_2.md).

Jobs can reach **`COMPLETED`**. Sending the result photo on Telegram is **Phase 5**.

## Setup

```bash
cd apps/api
cp .env.example .env
# Fill R2_*, CALLBACK_SHARED_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET,
# PUBLIC_BASE_URL (HTTPS tunnel or deploy URL), and MODAL_TOKEN_* for Docker
npm ci
npm run start:dev
```

### Local with Docker

From repo root:

```bash
cp apps/api/.env.example apps/api/.env   # once; add secrets
docker compose up --build
```

Compose overrides DB to the `postgres` service. Modal JS SDK needs `MODAL_TOKEN_ID` + `MODAL_TOKEN_SECRET` inside the container (host `~/.modal.toml` is not mounted by default).

- API: http://localhost:3000  
- Postgres 17: `localhost:5432` (user/password/db: `skoka`)  
- Hot reload via bind-mounted `apps/api/src`  

### Telegram webhook

```bash
# PUBLIC_BASE_URL must be HTTPS reachable by Telegram (and by Modal for callbacks)
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=${PUBLIC_BASE_URL}/webhooks/telegram" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

UX: send a photo; optional caption is the label (default `person`).

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
| POST | `/webhooks/telegram` | Telegram updates |
| POST | `/internal/jobs/:id/complete` | Modal success callback |
| POST | `/internal/jobs/:id/fail` | Modal failure callback |

## Tests

```bash
npm test
API_RUN_DB_E2E=1 npm run test:e2e
```

## Layout

```
src/
  config/           env + validation
  database/         TypeORM options, CLI DataSource
  jobs/             entities, repository, create/get API
  telegram/         webhook + Bot API client
  modal/            Modal spawn client
  orchestration/    dispatcher + recovery loops
  internal/         HMAC callback receivers
  storage/          R2 adapter + image validation
  health/
  migrations/
```
