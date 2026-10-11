# Skoka API (NestJS)

Phase 3 foundations: Postgres (TypeORM), Cloudflare R2, job persistence, local Docker Compose.

Handoff for the next phase: [`docs/PHASE_3.md`](../../docs/PHASE_3.md).  
Modal / callback contracts: [`docs/PHASE_2.md`](../../docs/PHASE_2.md).

Modal dispatch and Telegram are **Phase 4**. Jobs created here stop at **`QUEUED`**.

## Setup

```bash
cd apps/api
cp .env.example .env
# Fill R2_* (same private bucket as services/inference)
# Optional: point DATABASE_* at Supabase session pooler (see below)
npm ci
npm run start:dev
```

### Local with Docker

From repo root:

```bash
cp apps/api/.env.example apps/api/.env   # once; add R2_*
docker compose up --build
```

Compose overrides DB to the `postgres` service even if `.env` has Supabase settings.

- API: http://localhost:3000  
- Postgres 17: `localhost:5432` (user/password/db: `skoka`)  
- Hot reload via bind-mounted `apps/api/src`  
- Migrations: entrypoint `npm run migration:run` + Nest `migrationsRun` when `RUN_MIGRATIONS=true`

### Migrations

```bash
npm run migration:run
npm run migration:show
npm run migration:revert
npm run migration:generate -- src/migrations/DescriptiveName
```

CLI DataSource: `src/database/data-source.ts`.  
`synchronize` is always **false**.

### Supabase

Prefer **session pooler** (port 5432), not transaction pooler (6543):

```env
DATABASE_HOST=aws-0-<region>.pooler.supabase.com
DATABASE_PORT=5432
DATABASE_USER=postgres.<project-ref>
DATABASE_PASSWORD=
DATABASE_NAME=postgres
DATABASE_SSL=true
DATABASE_POOL_MAX=5
```

Direct `db.<ref>.supabase.co` can be IPv6-only. Details: [`docs/PHASE_3.md`](../../docs/PHASE_3.md).

### Dependency pins (do not casually bump)

| Package | Pin | Why |
|---------|-----|-----|
| `typeorm` | `0.3.27` | Nest 11 + current migration tooling |
| `@nestjs/config` | `4.0.2` | v12 is ESM-only → `ERR_REQUIRE_ESM` under CJS Nest build |
| `@nestjs/typeorm` | `11.0.0` | Matches TypeORM 0.3 |

## Endpoints (Phase 3)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness |
| GET | `/health/ready` | Postgres ready |
| GET | `/health/storage` | R2 probe (non-gating) |
| POST | `/api/jobs` | multipart: `file` + DTO fields |
| GET | `/api/jobs/:id` | Job by id |

DTO fields: `prompt`, `source`, `externalRequestId`, `channel`, `recipientId`.  
Image is a separate multipart part named **`file`** (Multer), not a DTO property.

```bash
curl -s -X POST http://localhost:3000/api/jobs \
  -F prompt=person \
  -F source=web \
  -F externalRequestId=demo-1 \
  -F channel=web \
  -F recipientId=local \
  -F file=@./sample.jpg
```

Expect `status: "QUEUED"` and `inputKey: "jobs/<uuid>/input.<ext>"`.

## Tests

```bash
npm test
API_RUN_DB_E2E=1 npm run test:e2e
```

## Layout

```
src/
  config/          env + validation
  database/        TypeORM options, CLI DataSource, migration helper
  jobs/            entities, repository, create/get API
  storage/         R2 adapter + image validation
  health/
  migrations/      TypeORM migrations (compiled with the app)
```
