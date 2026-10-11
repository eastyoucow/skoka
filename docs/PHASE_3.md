# Phase 3 — NestJS + Supabase/Postgres + R2 + local Docker (handoff)

Status: **complete** (superseded for next work by [`PHASE_4.md`](PHASE_4.md) → Phase 5).

NestJS owns job persistence, R2 input upload, and health. Phase 3 jobs stopped at **`QUEUED`**. Phase 4 added Telegram, Modal dispatch, callbacks, and recovery through **`COMPLETED`**. Delivery of the result photo is Phase 5.

Full product plan: [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).  
Phase 2 Modal/callback/R2 contracts: [`PHASE_2.md`](PHASE_2.md).  
Phase 1 library: [`PHASE_1.md`](PHASE_1.md).

---

## Decisions locked in Phase 3

| Topic | Decision |
|-------|----------|
| App path | `apps/api` — NestJS **11**, **npm**, standalone `package.json` (no npm workspaces yet) |
| Module system | TypeScript **CommonJS** (`tsconfig` `module: commonjs`) — Nest + TypeORM CLI friendly |
| ORM | **TypeORM `0.3.27`** (pinned). Do **not** jump to TypeORM 1.x without re-validating Nest/Jest |
| Config package | **`@nestjs/config@4.0.2`** (pinned). v12 is ESM-only and breaks CJS `require()` (`ERR_REQUIRE_ESM`) |
| `synchronize` | Always **`false`**. Schema only via migrations |
| Migrations location | `apps/api/src/migrations` (compiled with Nest build) |
| Migration run | **Dual:** Docker entrypoint `npm run migration:run`, then Nest `migrationsRun` when `RUN_MIGRATIONS=true` |
| CLI DataSource | `apps/api/src/database/data-source.ts` (`typeorm-ts-node-commonjs -d …`) |
| Local DB | Postgres **17** via root `docker-compose.yml`; volume `skoka_pg_data`; healthcheck; API `depends_on: service_healthy` |
| Prod/staging DB | **Supabase** Postgres over TLS. Prefer **session pooler** (see Supabase section below) |
| TLS verification | `DATABASE_SSL=true` → `ssl: { rejectUnauthorized: false }` (encrypted; no private CA bundle required for Supabase) |
| Object storage | Real Cloudflare R2 via `@aws-sdk/client-s3`. **No MinIO**. Same env names / key layout as inference |
| Python in Compose | **Never** — inference stays local CLI or Modal |
| Create-job API | `POST /api/jobs` multipart: DTO fields in body + separate Multer field `file` (not on DTO) |
| Phase 3 terminal job state | **`QUEUED`** after R2 input upload. No dispatcher yet |
| Claim helper | `JobsRepository.claimQueuedJob` (`FOR UPDATE SKIP LOCKED`) implemented for Phase 4 — unused in Phase 3 HTTP path |
| Callback auth | Env `CALLBACK_SHARED_SECRET` documented for parity with Modal; **verification endpoints are Phase 4** |
| Logging | Nest `Logger` + JSON strings including `jobId` (and later `attemptId`) |

---

## Repository shape after Phase 3

```
skoka/
├── README.md
├── .gitignore
├── docker-compose.yml              # api + postgres:17
├── docs/
│   ├── IMPLEMENTATION_PLAN.md
│   ├── PHASE_1.md
│   ├── PHASE_2.md
│   └── PHASE_3.md                  ← this file
├── apps/api/
│   ├── Dockerfile                  # node:22-bookworm-slim, hot reload CMD
│   ├── .dockerignore
│   ├── .env.example                # placeholders only
│   ├── .env                        # gitignored
│   ├── package.json                # pinned typeorm 0.3.27, @nestjs/config 4.0.2
│   ├── scripts/docker-entrypoint.sh
│   ├── README.md
│   ├── src/
│   │   ├── main.ts / app.module.ts
│   │   ├── config/                 # configuration.ts, env.validation.ts
│   │   ├── database/               # typeorm.config.ts, data-source.ts, migration-runner.ts
│   │   ├── jobs/
│   │   │   ├── entities/           # Job, JobAttempt, Delivery + status enums/transitions
│   │   │   ├── dto/create-job.dto.ts
│   │   │   ├── jobs.repository.ts  # transactional create/queue/claim
│   │   │   ├── jobs.service.ts     # validate → create → R2 put → QUEUED
│   │   │   └── jobs.controller.ts
│   │   ├── storage/                # r2.storage.ts, file-validation.ts
│   │   ├── health/
│   │   └── migrations/
│   │       └── 1739200000000-InitJobsSchema.ts
│   └── test/app.e2e-spec.ts        # set API_RUN_DB_E2E=1
└── services/inference/             # Phase 1–2 unchanged
```

---

## What was implemented

| Piece | Path | Behavior |
|-------|------|----------|
| Schema migration | `src/migrations/1739200000000-InitJobsSchema.ts` | `jobs`, `job_attempts`, `deliveries` + indexes/FKs |
| Entities / transitions | `src/jobs/entities/*` | Status enums; `assertJobTransition` |
| Job create | `JobsService.createWithUpload` | Idempotent `(source, external_request_id)` + delivery → R2 upload → `QUEUED` |
| Claim (Phase 4 ready) | `JobsRepository.claimQueuedJob` | Short TX, `SKIP LOCKED`, creates `job_attempts` row |
| R2 | `R2StorageService` | put/get/delete/ping; endpoint from `R2_ENDPOINT` or `R2_ACCOUNT_ID` |
| File validation | `file-validation.ts` | mime allowlist, size, magic bytes; key helpers |
| Health | `/health`, `/health/ready` (DB), `/health/storage` (R2, non-gating) |
| Docker | root `docker-compose.yml` + `apps/api/Dockerfile` | migrations in entrypoint; bind-mount `src` for hot reload |

---

## Data model (as migrated)

Matches plan § Minimal data model:

- **`jobs`**: UUID PK; `source` (`telegram`/`web`); `external_request_id`; `prompt`; `status` (`RECEIVED`→`QUEUED`→`PROCESSING`→`COMPLETED`/`FAILED`); `input_key` / `output_key` (object keys, not URLs); `object_count`; `active_attempt_id`; `next_attempt_at`; `lease_until`; `deadline_at`; timestamps. Unique `(source, external_request_id)`.
- **`job_attempts`**: UUID PK; `job_id` FK CASCADE; `attempt_number`; `modal_call_id`; `status`; `error`; `started_at` / `finished_at`. Unique `(job_id, attempt_number)`.
- **`deliveries`**: UUID PK; `job_id` FK CASCADE; `channel`; `recipient_id`; `status` (`PENDING`/`SENDING`/`SENT`/`FAILED`); `attempts`; leases/retries; `external_message_id`. Unique `(job_id, channel, recipient_id)`.

Legal transitions (`JOB_TRANSITIONS`):

- `RECEIVED` → `QUEUED` \| `FAILED`
- `QUEUED` → `PROCESSING` \| `FAILED`
- `PROCESSING` → `COMPLETED` \| `FAILED` \| `QUEUED` (re-queue for recovery)
- `COMPLETED` / `FAILED` → (none)

Create flow (Phase 3):

1. Validate image (`file` Multer field) + DTO.
2. TX: insert job `RECEIVED` + delivery (or return existing on unique conflict).
3. Upload bytes to R2 `jobs/{jobId}/input.{jpg|png|webp}` (**outside** DB TX).
4. TX: set `input_key`, transition `RECEIVED` → `QUEUED`, set `next_attempt_at`.

R2 keys (unchanged from Phase 2):

- Input: `jobs/{jobId}/input.<ext>`
- Output (Phase 4): `jobs/{jobId}/attempts/{attemptId}/result.png`

---

## Migration run logic

1. **Docker entrypoint** (`apps/api/scripts/docker-entrypoint.sh`): if `RUN_MIGRATIONS=true`, `npm run migration:run` then start Nest.
2. **Nest boot**: TypeORM `migrationsRun` when `runMigrations` config is true (`RUN_MIGRATIONS` not `false`). Second pass is a no-op if already applied.
3. **CLI** (host or `docker compose exec api …`):
   ```bash
   npm run migration:run
   npm run migration:show
   npm run migration:revert
   npm run migration:generate -- src/migrations/DescriptiveName
   ```

Applied successfully against:

- Local Compose Postgres 17
- Supabase (session pooler) — tables visible in project

---

## Supabase connection (locked practice)

Direct host `db.<ref>.supabase.co` may be **IPv6-only**; Node on IPv4-only networks gets `ENOTFOUND`.

**Use session pooler:**

```env
DATABASE_HOST=aws-0-<region>.pooler.supabase.com
DATABASE_PORT=5432
DATABASE_USER=postgres.<project-ref>
DATABASE_PASSWORD=<database password>
DATABASE_NAME=postgres
DATABASE_SSL=true
DATABASE_POOL_MAX=5
RUN_MIGRATIONS=true
```

Notes:

- Port **5432** = session mode (good for TypeORM). Avoid transaction pooler **6543** for the always-on API unless you know the tradeoffs.
- `DATABASE_URL` is also supported by TypeORM config if preferred over discrete fields.
- Compose **overrides** `DATABASE_HOST=postgres` etc. when using `docker compose up`, so local Docker still uses Compose Postgres even if `.env` points at Supabase.

---

## API surface (Phase 3)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | Liveness |
| GET | `/health/ready` | Postgres only (Compose readiness) |
| GET | `/health/storage` | R2 probe; does not gate process |
| POST | `/api/jobs` | multipart: fields `prompt`, `source`, `externalRequestId`, `channel`, `recipientId` + file part named **`file`** |
| GET | `/api/jobs/:id` | Job JSON |

`file` is **not** on `CreateJobDto`; it is `@UploadedFile()` via `FileInterceptor('file')`.

Manual smoke:

```bash
cd apps/api && npm run start:dev

curl -s http://localhost:3000/health/ready
curl -s http://localhost:3000/health/storage

curl -s -X POST http://localhost:3000/api/jobs \
  -F prompt=person \
  -F source=web \
  -F externalRequestId=local-$(date +%s) \
  -F channel=web \
  -F recipientId=me \
  -F file=@"/path/to/image.jpg"

curl -s http://localhost:3000/api/jobs/<id>
# Expect status QUEUED and inputKey jobs/<id>/input.jpg
```

---

## Env files

| File | Role |
|------|------|
| `apps/api/.env.example` | Committed placeholders |
| `apps/api/.env` | Gitignored — local/Supabase/R2/callback secret |
| `services/inference/.env` / `.env.modal` | Unchanged Phase 2; share `R2_*` and `CALLBACK_SHARED_SECRET` values |

Never commit secrets. Docker Compose reads `apps/api/.env` via `env_file` and overrides DB host for the `api` service.

---

## Tests

```bash
cd apps/api
npm test                          # unit: file validation + transitions
API_RUN_DB_E2E=1 npm run test:e2e # needs Postgres; R2 mocked
```

E2E Jest config allows transforming ESM edge cases; with `@nestjs/config@4` CJS pin, boot path is stable.

---

## Known limitations / tech debt

1. Jobs remain **`QUEUED` forever** until Phase 4 dispatcher + Modal.
2. No Telegram / internal callback routes yet.
3. No delivery loop (delivery rows created as `PENDING` only).
4. `claimQueuedJob` not wired to a scheduler/loop.
5. Create-job HTTP is a **dev/foundation** endpoint; production V1 ingress is Telegram (Phase 4).
6. Supabase region/host must match the project; pooler user must be `postgres.<ref>`.
7. Pin **`@nestjs/config@4.0.2`** and **`typeorm@0.3.27`** until an intentional upgrade.
8. Local Node on the author machine was `v20.15.1` (below some package engines); Docker uses **Node 22**.

---

## What Phase 4 must know / reuse

### Reuse as-is

- Do **not** reimplement SAM3; call Modal per [`PHASE_2.md`](PHASE_2.md).
- Entities, transitions, `createReceivedJob` / `markQueuedWithInput` / `claimQueuedJob`.
- R2 adapter + key helpers; same private bucket as Modal worker.
- `CALLBACK_SHARED_SECRET` already in API env example — implement verification matching [`callback.py`](../services/inference/src/inference/callback.py).
- Compose/Docker layout stays; Python stays out.

### Modal invocation (from Phase 2)

```text
App: skoka-inference
Function: run_job
Secret: skoka-dev
Persist call.object_id → job_attempts.modal_call_id
Payload: { jobId, attemptId, inputKey, prompt, outputKey, callbackUrl }
callbackUrl = NestJS API origin only (no path)
```

### Callback HTTP (implement Nest receivers)

| Method | Path | Body |
|--------|------|------|
| POST | `/internal/jobs/{jobId}/complete` | `attemptId`, `count`, `outputKey` |
| POST | `/internal/jobs/{jobId}/fail` | `attemptId`, `code`, `message` |

Auth: Bearer + `X-Skoka-Timestamp` + `X-Skoka-Signature` (HMAC-SHA256 of `timestamp + "." + raw_body`); reject skew > 5 minutes; accept only **active** `attemptId`; at-least-once safe.

### Suggested Phase 4 entry checklist

1. Telegram webhook secret, photo download → reuse create/queue path (idempotent on `update_id` as `external_request_id`).
2. Background dispatcher: `claimQueuedJob` → Modal `spawn` → persist `modal_call_id` / attempt status (no DB TX over network I/O).
3. Internal complete/fail endpoints with HMAC + active-attempt gates; activate delivery in same TX as completion.
4. Recovery loop: expired leases, bounded retries, deadlines, avoid duplicate GPU when possible.
5. Tests: duplicate Telegram update, concurrent claim, callback before ack, stale attempt.
6. Stop when a Telegram photo becomes `COMPLETED` and survives Nest restart (delivery of photo can be Phase 5 if scoped that way — plan Phase 4 done-when includes completed job; delivery loop is Phase 5).

### Pointers for the next agent

| Doc / path | Why |
|------------|-----|
| [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) § Phase 4 | Scope |
| This file | Nest layout, migrations, Supabase, decisions |
| [`PHASE_2.md`](PHASE_2.md) | Modal names, callback HMAC, R2 keys, `skoka-dev` |
| [`apps/api/src/jobs/jobs.repository.ts`](../apps/api/src/jobs/jobs.repository.ts) | Claim / queue TX helpers |
| [`apps/api/src/storage/r2.storage.ts`](../apps/api/src/storage/r2.storage.ts) | R2 client |
| [`services/inference/src/inference/callback.py`](../services/inference/src/inference/callback.py) | Exact headers Nest must verify |
| [`apps/api/.env.example`](../apps/api/.env.example) | Env var names |

### Credentials (already used in Phase 3; keep in gitignored `.env`)

- Supabase pooler host/user/password (migrations applied)
- R2 scoped keys (same bucket as inference)
- `CALLBACK_SHARED_SECRET` (shared with Modal secret `skoka-dev` — enforce in Phase 4)

Still needed for Phase 4/5 (not Phase 3): Telegram bot token + webhook secret; public HTTPS base URL for callbacks (e.g. Render); Modal token if not already on the machine.
