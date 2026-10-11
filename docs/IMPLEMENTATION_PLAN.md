# Image Object Counter — Architecture & Implementation Plan

> Working specification for Cursor/Claude. Implement **one phase at a time**; after each phase run tests, summarize changes and open questions, and wait for approval before continuing. Prefer simplicity and low recurring cost.

## Goal and constraints

- User provides a photo and text label (e.g. `person`, `cat`, `apple`); system counts matching instances and returns the image with instance masks overlaid plus count. In v1 we send just image and search only for `person`
- **V1:** Telegram bot. **V2:** Next.js web UI (upload, submit, poll, display/download static result; no mask editing or history).
- Hundreds of requests/day; occasional concurrency; ~60-second target, **not** guaranteed under cold starts/bursts. Temporary images only. Cheap idle operation.
- Develop **Python inference first**, independently of backend. Use existing Hugging Face `facebook/sam3` model via `transformers` (`Sam3Model`, `Sam3Processor`) subject to verified version/access/license and GPU requirements.

## Agreed stack

| Responsibility | Choice |
|---|---|
| ML inference and mask overlay | Python, PyTorch, Transformers, Pillow; Modal serverless GPU |
| API, Telegram webhook, durable orchestration and delivery | NestJS, TypeScript, TypeORM; Render (always-on paid instance for reliable in-process polling) |
| Durable job state | Supabase managed PostgreSQL (ordinary Postgres connection, TLS, migrations) |
| Temporary image storage | Private Cloudflare R2 bucket via S3-compatible API (`@aws-sdk/client-s3` in NestJS, `boto3` in Python) |
| V2 frontend | Next.js, React, separate deployment TBD |

**Not in V1:** Kafka, Redis, Kubernetes, standalone queue, user accounts, image history, interactive masks, separate NestJS worker deployment. PostgreSQL serves as durable queue. Start with one NestJS instance, but implement safe leases/claims to allow later horizontal scaling. No public bucket objects. Store **object keys**, not permanent URLs, in DB. Lifecycle-delete R2 objects after ~24h; maximum processing/retry deadline must be shorter than retention. Keep job metadata ~7–30 days without images. Never store secrets in code.

## System boundaries

- **NestJS** owns Telegram transport, input validation, jobs and attempts, DB transactions, dispatch/recovery loops, authenticated callbacks, delivery retries and V2 API. It does **not** execute SAM3.
- **Modal Python** owns downloading input from R2, loading/caching SAM3 per warm GPU container, segmentation, counting, overlay rendering, uploading output to R2, reporting completion/failure. It knows `jobId` and `attemptId`, but nothing about Telegram users.
- **R2** stores `jobs/{jobId}/input.<ext>` and `jobs/{jobId}/attempts/{attemptId}/result.png`. Keys are generated server-side. Prefer scoped credentials; signed URLs are an alternative, accounting for expiry.
- **Next.js V2** calls NestJS API; no direct Modal calls or private storage credentials in browser.

## V1 workflow

1. Telegram sends a webhook containing a photo and requested object label. Verify webhook secret; parse a documented command/caption convention (e.g. photo caption `cat`, or ask user for label). Validate prompt and image limits. **Return 2xx promptly**; do not run inference in webhook handler.
2. Create a `jobs` record idempotently using unique `(source, external_request_id)` (Telegram `update_id`); store recipient in `deliveries`. Download Telegram file and upload it to R2. Transition `RECEIVED -> QUEUED` only once input is stored. Handle partial upload/crash with recovery/expiry.
3. NestJS dispatcher claims queued jobs in a **short** Postgres transaction using `FOR UPDATE SKIP LOCKED`, sets a lease and attempt ID, commits, then submits work to Modal. **Do not hold a DB transaction over network I/O.** Persist returned execution identifier when available.
4. Modal fetches input, runs SAM3, creates colored semi-transparent per-instance overlays and count, uploads attempt-specific result to R2, then calls authenticated NestJS completion/failure endpoint. The Modal job must be asynchronous from the NestJS HTTP request; verify exact Modal invocation/callback mechanism against current SDK/docs during implementation.
5. NestJS atomically accepts a callback **only for the active attempt** and valid state; persist output key/count and activate Telegram delivery in the same DB transaction. Duplicate/obsolete callbacks return success without duplicate deliveries.
6. Delivery loop claims pending deliveries, fetches result from R2 and sends Telegram photo with count. Record Telegram message ID and `SENT` status. Retry transient failures with backoff; never rerun inference because delivery failed.
7. Recovery loop reconciles expired leases / missing callbacks and retries or fails jobs with bounded attempts, deadlines and backoff. Where possible check known Modal execution before resubmitting to avoid duplicate GPU cost. Terminal failures notify user once.

### Consistency guarantees / known limitations

- Postgres and Modal do not share a transaction: crash after Modal submission but before DB acknowledgement can trigger **duplicate inference**. Stable job/attempt IDs, attempt-specific output keys and conditional callback acceptance prevent corrupt final state; they do **not** guarantee exactly-once GPU execution.
- Telegram and Postgres do not share a transaction: ambiguous `sendPhoto` timeout can lead to **duplicate messages**. Accept at-least-once delivery and track `external_message_id` when available.
- Webhook redelivery should not create duplicate jobs (unique external ID). Do not equate `COMPLETED` processing with `SENT` Telegram delivery.
- Ensure a completion callback can arrive before dispatcher's submission acknowledgement; transitions must not regress `COMPLETED` back to `PROCESSING`.
- Validate callback authenticity (HMAC or shared secret with replay protection); authorize object key/attempt association, and avoid arbitrary URL fetching/SSRF.
- Do not assume 60 seconds is achievable before measuring SAM3 cold start, GPU memory and warm inference time.

## Minimal data model

- `jobs`: `id UUID PK`, `source` (`telegram`/`web`), `external_request_id`, `prompt`, `status` (`RECEIVED`, `QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`), `input_key`, `output_key`, `object_count`, `active_attempt_id`, `next_attempt_at`, `lease_until`, `deadline_at`, timestamps; unique `(source, external_request_id)` **with source-scoped identity for web users**.
- `job_attempts`: `id UUID PK`, `job_id FK`, `attempt_number`, `modal_call_id`, `status`, `error`, `started_at`, `finished_at`; unique `(job_id, attempt_number)`.
- `deliveries`: `id UUID PK`, `job_id FK`, `channel`, `recipient_id`, `status` (`PENDING`, `SENDING`, `SENT`, `FAILED`), `attempts`, `lease_until`, `next_retry_at`, `external_message_id`, timestamps; unique `(job_id, channel, recipient_id)`.
- Index eligible job/delivery states and retry times. Use migrations (`synchronize: false`). Model legal transitions explicitly; transactions for status+delivery changes.

## API contracts (initial proposal; refine in implementation)

- `POST /webhooks/telegram`: Telegram update, authenticated by configured webhook secret; idempotent.
- `POST /internal/jobs/:jobId/complete`: signed callback `{attemptId, count, outputKey}`.
- `POST /internal/jobs/:jobId/fail`: signed callback `{attemptId, code, message}` (sanitize error text).
- V2: `POST /api/uploads` (presigned PUT), `POST /api/jobs` (upload key, prompt, idempotency key), `GET /api/jobs/:id`, `GET /api/jobs/:id/result` (short-lived presigned GET). Auth/ownership must be designed before public V2 launch.
- Modal payload `{jobId, attemptId, inputKey, prompt, outputKey, callbackUrl}`. Never send secrets in payload/logs; callback auth via deployment secrets.
- Result count = number of accepted **instance** masks after confidence/size filtering; return a deterministic count for the same model/config/image, subject to model behavior. Record inference config/model version for debugging if useful.

## Development phases — complete sequentially

### Phase 0 — Repository and design baseline
- [x] Minimal monorepo baseline: `services/inference` Python, root README, `.gitignore`, service-local `.env.example` (no NestJS/`apps/` yet; no CI yet).
- [ ] Document Telegram photo+prompt UX, image size/format limits, job timeout/retry policy, callback auth design and budget cap.
- [x] Keep Python service runnable locally without NestJS; library contract documented in [`PHASE_1.md`](PHASE_1.md); NestJS↔Modal callback contract documented in [`PHASE_2.md`](PHASE_2.md).
- **Done when:** clean checkout and setup instructions work; no cloud resources required. *(Partial — inference setup works; NestJS/apps/CI deferred.)*

### Phase 1 — Python SAM3 locally **(implement first)**
- [x] Create isolated Python environment and pinned dependencies; verify model availability/license, CPU/GPU support and minimum VRAM.
- [x] Implement `segment(image, prompt)` returning instance masks, scores, count; handle no detections and corrupt images.
- [x] Implement separate `render(image, masks)` with semi-transparent colored overlays, optional contours; preserve correct mask/image sizing.
- [x] CLI: `python -m inference.cli --image sample.jpg --prompt cat --output result.png`; print JSON `{count, ...}`.
- [x] Unit tests for rendering/counting (mock inference), fixture-based integration test, measure memory/warm inference latency.
- **Done when:** local CLI reliably outputs count and highlighted image.  
  **Handoff:** [`PHASE_1.md`](PHASE_1.md).

### Phase 2 — Deploy Python to Modal
- [x] Build Modal image with pinned ML dependencies; load SAM3 once per warm GPU worker; initial GPU T4 (re-pick after benchmarks).
- [x] Set `min_containers=0`, `max_containers=2`, timeout/memory; cold/warm latency table to fill after first deploy ([`PHASE_2.md`](PHASE_2.md)).
- [x] Implement S3-compatible R2 read/write via `boto3`; private bucket, scoped credentials; lifecycle cleanup (~24h) configured in Cloudflare (manual).
- [x] Expose async Modal `spawn` invocation compatible with NestJS; payload `{jobId, attemptId, inputKey, prompt, outputKey, callbackUrl}`.
- [x] Implement authenticated HTTP callback client (HMAC + Bearer); **Option B:** no live NestJS receiver — unit tests mock HTTP. Contract in [`PHASE_2.md`](PHASE_2.md).
- [x] Do **not** containerize Python/SAM3; do **not** add Docker Compose (deferred to Phase 3 with NestJS).
- **Done when:** Modal worker can download from R2, run SAM3, upload result, and invoke the callback client (mocked in tests + manual R2 smoke when credentials exist); measured cost/latency documented in [`PHASE_2.md`](PHASE_2.md).  
  **Handoff:** [`PHASE_2.md`](PHASE_2.md) — decisions, Modal `skoka-dev` secret, `spawn` contract, callback auth, R2 keys, Phase 3 entry checklist. *(Fill latency/cost numbers after more GPU runs; not a Phase 3 blocker.)*

### Phase 3 — NestJS + Supabase + R2 foundations + local Docker
- [x] Scaffold NestJS under `apps/` (or agreed path); preserve monorepo layout and package management.
- [x] **Local Docker (required):** NestJS Dockerfile with hot reload; Postgres 17 official image; named volume for data; Postgres healthcheck and NestJS `depends_on` until healthy; env via `.env.example`; migrations runnable inside the API container; `docker compose up --build`; `.dockerignore`; README setup/commands. Constraints: no Python/SAM3 in Compose; no MinIO (use real R2); no secrets in git; keep setup simple for local dev.
- [x] Deploy/connect NestJS to Supabase Postgres (prod) with TLS, small pool and TypeORM migrations; local Compose Postgres for development.
- [x] Implement jobs/attempts/deliveries schema, state transitions and transactional repository methods.
- [x] Implement R2 storage adapter and file validation; health endpoints and structured logs with `jobId`/`attemptId`.
- [x] Unit/integration tests with local Postgres and S3-compatible test storage or mocks.
- **Done when:** `docker compose up --build` starts API + Postgres; API can create job, upload input to R2, persist state and read it after restart.  
  **Handoff:** [`PHASE_3.md`](PHASE_3.md) — Nest layout, TypeORM/migration dual-run, Supabase session pooler, R2 create→`QUEUED`, pins (`typeorm@0.3.27`, `@nestjs/config@4.0.2`), Phase 4 entry checklist.

### Local Docker development (from Phase 3)

Implement when NestJS lands. Requirements:

| Requirement | Detail |
|---|---|
| NestJS Dockerfile | Hot reload for local development |
| PostgreSQL 17 | Official Docker image |
| Persistent volume | Named Docker volume for Postgres data |
| Startup order | Postgres healthcheck; NestJS starts only when DB is ready (`depends_on` + condition) |
| Configuration | Environment variables; update `.env.example` (placeholders only) |
| Migrations | Executable inside the API container |
| One command | `docker compose up --build` |
| Ignore files | Appropriate `.dockerignore` files |
| Docs | README setup instructions and common commands |

**Constraints:** Do not containerize Python/SAM3 (runs locally or on Modal). Do not add MinIO — use a real Cloudflare R2 development bucket. Keep the setup simple and suitable for local development. Preserve the existing monorepo structure and package management. Do not modify application business logic unless necessary for Docker compatibility. Do not commit secrets or real credentials.

### Phase 4 — Telegram + reliable dispatch/callbacks
- [x] Telegram webhook secret validation, caption/command UX, file download, deduplication by `update_id`, immediate acknowledgement.
- [x] PostgreSQL dispatcher: claim/lease with `SKIP LOCKED`, Modal submit, attempt tracking, bounded concurrency.
- [x] Callback auth, active-attempt validation, atomic completion/failure and delivery activation.
- [x] Recovery loop: expired leases, retries/backoff, stale jobs, callback reconciliation, terminal failure.
- [x] Tests: repeated Telegram update, concurrent dispatchers, crash after submit, callback before acknowledgement, duplicate/stale callback.
- **Done when:** a Telegram photo reaches Modal and becomes a completed job, surviving NestJS restarts.  
  **Handoff:** [`PHASE_4.md`](PHASE_4.md).

### Phase 5 — Delivery, deployment and hardening
- [x] Delivery loop sends result photo+count, persists message ID, retries failures, sends terminal error message.
- [x] Deploy always-on NestJS to Render with environment secrets; configure Telegram webhook and HTTPS callback endpoint. *(code: `render.yaml` + `Dockerfile.prod`; dashboard secrets/webhook cutover in [`PHASE_5.md`](PHASE_5.md))*
- [x] Configure R2 lifecycle, Supabase backups/retention appropriate to tier, spending alerts/caps and rate limits. *(rate limit in Nest; lifecycle/backups/spend caps documented as ops checklist)*
- [x] End-to-end tests for concurrency, timeouts, invalid images, no detections, duplicate updates, storage expiry and process restarts. *(delivery arm/send/retry paths + prior Phase 4 cases; full live GPU matrix remains manual smoke)*
- [x] Add metrics: queue wait, cold/warm inference, failures, retries, deliveries, cost per image. *(structured `msg:metric` logs; cold/warm + $/image via Modal billing)*
- **Done when:** V1 works end-to-end with bounded costs and documented recovery behavior.  
  **Handoff:** [`PHASE_5.md`](PHASE_5.md).

### Phase 6 — Next.js V2 (later)
- [ ] Build React upload/prompt/status/result/download UI; reuse NestJS jobs domain.
- [ ] Add web authentication/ownership and idempotency scope; presigned direct-to-R2 uploads.
- [ ] Implement NestJS web endpoints and status polling; short-lived signed result download.
- [ ] Test browser uploads, CORS, private-object access, expiration, simultaneous jobs, mobile layout.
- **Done when:** web users can submit images and retrieve static results without changes to SAM3 processing.

## Engineering rules for Claude

1. Work on **one phase only** per request; do not scaffold later phases beyond what the current phase requires.
2. First inspect existing repo and current Modal/Transformers API compatibility. If documentation conflicts with this plan, flag the discrepancy rather than inventing APIs.
3. Prefer simple, testable functions and small modules. Keep inference, rendering, storage, transport, and orchestration separate.
4. For every phase: implement, run relevant tests/lint, update README/env example, summarize architecture choices and known limitations, then stop.
5. Never commit credentials or real user images. Avoid exposing private R2 URLs or raw exception traces to users.

## Open decisions to resolve just-in-time

- GPU selection after first Modal benchmarks; cold-start tradeoff and actual SAM3 VRAM footprint (start with one CUDA SKU, `max_containers=2`).
- Render region vs Supabase region, instance sizes and current pricing; free plans may sleep/pause and are not suitable for reliable background dispatch.
- Telegram caption UX (default `person` + caption override locked in Phase 4); delivery retry schedule locked in Phase 5 (`DELIVERY_*` defaults). Upload resizing still open if needed later.
- V2 authentication provider, web idempotency scope and whether to keep any metadata after image expiration.

### Resolved in Phase 2 (see [`PHASE_2.md`](PHASE_2.md))

- Modal invocation: deploy app `skoka-inference`, function `run_job`; NestJS will use `Function.from_name(...).spawn(...)` and store `object_id` as `modal_call_id`.
- Callbacks: Bearer + HMAC-SHA256 (`X-Skoka-Timestamp`, `X-Skoka-Signature`); bounded retries on 5xx/network/429; NestJS must treat delivery as at-least-once and key on active `attemptId`.
- R2: direct scoped credentials in Modal Secret `skoka-dev` / env (not signed URLs for the worker).
- Local Docker Compose: Phase 3 with NestJS + Postgres 17; Python stays out of Compose.

### Resolved in Phase 3 (see [`PHASE_3.md`](PHASE_3.md))

- Nest app at `apps/api` (Nest 11, npm, CommonJS). ORM TypeORM **0.3.27** with `synchronize: false`.
- Pin `@nestjs/config@4.0.2` (v12 is ESM-only and breaks CJS boot).
- Migrations under `src/migrations`; run via Docker entrypoint **and** Nest `migrationsRun` when `RUN_MIGRATIONS=true`; CLI DataSource `src/database/data-source.ts`.
- Supabase: prefer **session pooler** `aws-0-<region>.pooler.supabase.com:5432` with user `postgres.<ref>`; `DATABASE_SSL=true` and `rejectUnauthorized: false`. Direct `db.*` may be IPv6-only.
- Compose Postgres 17 remains the local default (`DATABASE_HOST=postgres` override). Python/SAM3 never in Compose; no MinIO.
- Phase 3 HTTP create path ends at job status **`QUEUED`** with R2 `input_key`; dispatcher/Telegram/callbacks are Phase 4.

### Resolved in Phase 4 (see [`PHASE_4.md`](PHASE_4.md))

- Telegram ingress: `POST /webhooks/telegram`, secret header, dedupe on `update_id`, caption prompt (default `person`).
- Modal from Nest via npm `modal` JS SDK `spawn([payload])`; store `functionCallId` as `modal_call_id`.
- `PUBLIC_BASE_URL` is API origin for Modal callbacks **and** Telegram webhook target; local ngrok verified end-to-end to `COMPLETED`.
- Callback receivers implement Phase 2 HMAC contract with Nest `rawBody: true`; active-attempt gate; `outputKey` must match attempt path.
- In-process dispatcher + recovery (`setInterval`, no `@nestjs/schedule`); delivery **send** deferred to Phase 5 (`deliveries` armed with `next_retry_at` only).
- Docker Compose needs `MODAL_TOKEN_ID`/`SECRET` (host `~/.modal.toml` not mounted).
