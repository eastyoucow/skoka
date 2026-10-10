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
- [ ] Set up monorepo (`apps/api` NestJS, `services/inference` Python, `apps/web` reserved), README, `.env.example`, ignore secrets, formatting/linting, basic CI.
- [ ] Document Telegram photo+prompt UX, image size/format limits, job timeout/retry policy, callback auth design and budget cap.
- [ ] Define typed cross-service request/result contract; keep Python service runnable locally without NestJS.
- **Done when:** clean checkout and setup instructions work; no cloud resources required.

### Phase 1 — Python SAM3 locally **(implement first)**
- [ ] Create isolated Python environment and pinned dependencies; verify model availability/license, CPU/GPU support and minimum VRAM.
- [ ] Implement `segment(image, prompt)` returning instance masks, scores, count; handle no detections and corrupt images.
- [ ] Implement separate `render(image, masks)` with semi-transparent colored overlays, optional contours; preserve correct mask/image sizing.
- [ ] CLI: `python -m inference.cli --image sample.jpg --prompt cat --output result.png`; print JSON `{count, ...}`.
- [ ] Unit tests for rendering/counting (mock inference), fixture-based integration test, measure memory/warm inference latency.
- **Done when:** local CLI reliably outputs count and highlighted image.

### Phase 2 — Deploy Python to Modal
- [ ] Build Modal image with pinned ML dependencies; load SAM3 once per warm GPU worker; pick GPU based on benchmarks.
- [ ] Set `min_containers=0`, conservative `max_containers` (start 2), request timeout and memory; benchmark cold starts and parallel load.
- [ ] Implement S3-compatible R2 read/write via `boto3`; private bucket, scoped credentials, lifecycle cleanup.
- [ ] Expose async invocation compatible with NestJS; authenticated callback after successful R2 upload; bounded retry of callback failures.
- [ ] Integration test with input/output R2 keys, including duplicate callback and worker failure simulation.
- **Done when:** one externally submitted job produces an R2 result and completion event; measured cost/latency documented.

### Phase 3 — NestJS + Supabase + R2 foundations
- [ ] Deploy/connect NestJS to Supabase Postgres with TLS, small pool and TypeORM migrations.
- [ ] Implement jobs/attempts/deliveries schema, state transitions and transactional repository methods.
- [ ] Implement R2 storage adapter and file validation; health endpoints and structured logs with `jobId`/`attemptId`.
- [ ] Unit/integration tests with local Postgres and S3-compatible test storage or mocks.
- **Done when:** API can create job, upload input, persist state and read it after restart.

### Phase 4 — Telegram + reliable dispatch/callbacks
- [ ] Telegram webhook secret validation, caption/command UX, file download, deduplication by `update_id`, immediate acknowledgement.
- [ ] PostgreSQL dispatcher: claim/lease with `SKIP LOCKED`, Modal submit, attempt tracking, bounded concurrency.
- [ ] Callback auth, active-attempt validation, atomic completion/failure and delivery activation.
- [ ] Recovery loop: expired leases, retries/backoff, stale jobs, callback reconciliation, terminal failure.
- [ ] Tests: repeated Telegram update, concurrent dispatchers, crash after submit, callback before acknowledgement, duplicate/stale callback.
- **Done when:** a Telegram photo reaches Modal and becomes a completed job, surviving NestJS restarts.

### Phase 5 — Delivery, deployment and hardening
- [ ] Delivery loop sends result photo+count, persists message ID, retries failures, sends terminal error message.
- [ ] Deploy always-on NestJS to Render with environment secrets; configure Telegram webhook and HTTPS callback endpoint.
- [ ] Configure R2 lifecycle, Supabase backups/retention appropriate to tier, spending alerts/caps and rate limits.
- [ ] End-to-end tests for concurrency, timeouts, invalid images, no detections, duplicate updates, storage expiry and process restarts.
- [ ] Add metrics: queue wait, cold/warm inference, failures, retries, deliveries, cost per image.
- **Done when:** V1 works end-to-end with bounded costs and documented recovery behavior.

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

- Modal submission interface and how to inspect/reconcile running jobs; callback retry strategy and exact API behavior.
- GPU selection, cold-start tradeoff, `max_containers`, actual SAM3 model footprint and prompt/mask quality.
- Render region vs Supabase region, instance sizes and current pricing; free plans may sleep/pause and are not suitable for reliable background dispatch.
- Telegram caption UX, upload limits, image resizing, maximum queue age and retry schedule.
- Callback authentication approach; whether to use direct R2 credentials or signed URLs for Modal.
- V2 authentication provider, web idempotency scope and whether to keep any metadata after image expiration.
