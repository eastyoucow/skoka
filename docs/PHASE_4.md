# Phase 4 — Telegram + Modal dispatch + signed callbacks + recovery (handoff)

Status: **complete — ready for Phase 5** (delivery loop, Render deploy, hardening).

NestJS accepts Telegram photos, queues jobs to R2, dispatches to Modal `run_job`, accepts HMAC callbacks, and recovers expired leases. Jobs can reach **`COMPLETED`**. Sending the result photo on Telegram is **not implemented** — that is Phase 5.

**Verified locally:** Telegram photo → ngrok → Nest → Modal GPU → HMAC callback → job `COMPLETED` (user smoke). No Telegram result message by design until Phase 5.

Full product plan: [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).  
Phase 3 Nest/DB/R2: [`PHASE_3.md`](PHASE_3.md).  
Phase 2 Modal/callback contract: [`PHASE_2.md`](PHASE_2.md).

---

## Decisions locked in Phase 4

| Topic | Decision |
|-------|----------|
| Telegram UX | Photo required. Caption = prompt; empty caption → `TELEGRAM_DEFAULT_PROMPT` (`person`). `/start` `/help` reply with short instructions. Image documents (`image/*`) accepted. |
| Dedup | `update_id` stored as `jobs.external_request_id` with `source=telegram` |
| Webhook auth | Header `X-Telegram-Bot-Api-Secret-Token` must match `TELEGRAM_WEBHOOK_SECRET` |
| Ack timing | Handler downloads Telegram file + uploads R2 + queues, then returns 200. Inference is async via dispatcher. |
| Modal invoke | Official npm `modal` JS SDK: `ModalClient` → `functions.fromName(app, fn).spawn([payload])`; persist `functionCallId` as `modal_call_id` |
| Callback URL | `PUBLIC_BASE_URL` (API origin, **no path**) passed as Modal `callbackUrl` |
| Modal → Nest | Modal worker **HTTP POSTs** to Nest (not Telegram). Paths: `/internal/jobs/{jobId}/complete` and `/fail`. Same public HTTPS origin as Telegram webhook (ngrok locally, Render in prod). |
| Callback auth | Same as Phase 2: Bearer + `X-Skoka-Timestamp` + `X-Skoka-Signature` (HMAC-SHA256 of `timestamp + "." + raw_body`); skew ≤ 5 min; Nest `rawBody: true` |
| Active attempt | Complete/fail apply only when `job.active_attempt_id === attemptId` and status is `PROCESSING`; duplicates return 200 with `applied: false` |
| Output key gate | Complete body `outputKey` must equal `jobs/{jobId}/attempts/{attemptId}/result.png` |
| Dispatcher | In-process `setInterval` poller; claim with `SKIP LOCKED` then network spawn; never hold DB TX over I/O |
| Concurrency | `DISPATCHER_MAX_CONCURRENT` default 2 (matches Modal `max_containers`) |
| Recovery | Expired `PROCESSING` leases → fail attempt, re-queue or terminal `FAILED`; stale `RECEIVED` past deadline → `FAILED` |
| Modal status check | **Not** implemented in V1 — lease expiry may re-dispatch (duplicate GPU possible; documented) |
| Delivery send | **Phase 5**; on complete/terminal fail Phase 4 only sets `deliveries.next_retry_at = now` while status stays `PENDING` |
| Scheduler package | No `@nestjs/schedule` (Node engine friction); plain timers with `unref()` |
| Local tunnel | ngrok / cloudflared to `:3000` works for **both** Telegram webhook and Modal callbacks when `PUBLIC_BASE_URL` is the tunnel origin |

---

## End-to-end data flow (what works today)

```
Telegram ──webhook──► Nest /webhooks/telegram
                         │ download photo, R2 put, job QUEUED
                         ▼
              Dispatcher (SKIP LOCKED claim)
                         │ Modal JS spawn(payload)
                         ▼
              Modal cloud GPU (skoka-inference / run_job)
                         │ R2 get input → SAM3 → R2 put result
                         │ HTTP POST {PUBLIC_BASE_URL}/internal/jobs/.../complete
                         ▼
              Nest acceptCompletion (active attempt only)
                         │ job COMPLETED + object_count + output_key
                         │ deliveries.next_retry_at = now (still PENDING)
                         ▼
              ★ Phase 5: claim delivery → R2 get → Telegram sendPhoto ★
```

Important distinction:

- **Telegram webhook** = ingress (user → Nest). Needs public HTTPS.
- **Modal callback** = egress from Modal cloud → Nest internal API. Also needs public HTTPS (`PUBLIC_BASE_URL`).
- **Telegram result** = Nest → Bot API `sendPhoto` (outbound). Does **not** need a webhook; only needs `TELEGRAM_BOT_TOKEN`. Missing today because delivery loop is Phase 5.

---

## Repository shape (new / changed)

```
apps/api/src/
  config/                 # PUBLIC_BASE_URL, telegram, modal, dispatcher, recovery
  telegram/               # webhook controller, Bot API client, prompt UX
  modal/                  # ModalInferenceClient (JS SDK spawn wrapper)
  orchestration/          # DispatcherService + RecoveryService
  internal/               # CallbackAuthGuard + complete/fail controllers
  jobs/jobs.repository.ts # claim, submit, acceptCompletion/Failure, recover*
  jobs/jobs.service.ts    # createWithImageBuffer (HTTP + Telegram)
  main.ts                 # rawBody: true
```

Key files for Phase 5:

| Path | Role |
|------|------|
| [`telegram/telegram.client.ts`](../apps/api/src/telegram/telegram.client.ts) | Has `getFile` / `downloadFile` / `sendMessage` — **add `sendPhoto`** |
| [`jobs/entities/delivery.entity.ts`](../apps/api/src/jobs/entities/delivery.entity.ts) | `PENDING` → `SENDING` → `SENT` / `FAILED`; leases + `external_message_id` |
| [`jobs/jobs.repository.ts`](../apps/api/src/jobs/jobs.repository.ts) | Completion already arms `next_retry_at`; **add delivery claim helpers** |
| [`storage/r2.storage.ts`](../apps/api/src/storage/r2.storage.ts) | `getObject` for result bytes |
| [`orchestration/`](../apps/api/src/orchestration/) | Pattern to copy for a delivery poller (`setInterval` + SKIP LOCKED) |

---

## Env (additions vs Phase 3)

| Variable | Purpose |
|----------|---------|
| `PUBLIC_BASE_URL` | HTTPS origin Modal callbacks + Telegram webhook target |
| `TELEGRAM_BOT_TOKEN` | Bot API |
| `TELEGRAM_WEBHOOK_SECRET` | Webhook `secret_token` |
| `TELEGRAM_DEFAULT_PROMPT` | Default `person` |
| `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET` | Required in Docker/Render; optional on host if `~/.modal.toml` exists |
| `MODAL_APP_NAME` / `MODAL_FUNCTION_NAME` | Defaults `skoka-inference` / `run_job` |
| `JOB_MAX_ATTEMPTS` / `JOB_LEASE_MS` / `JOB_RETRY_BACKOFF_MS` | Retry policy |
| `DISPATCHER_*` / `RECOVERY_*` | Loop toggles and intervals |
| `CALLBACK_MAX_SKEW_SECONDS` | Default 300 |

Share the **same** `CALLBACK_SHARED_SECRET` with Modal secret `skoka-dev`.

Placeholders: [`apps/api/.env.example`](../apps/api/.env.example). Real values live only in gitignored `apps/api/.env`.

---

## HTTP surface (Phase 4)

| Method | Path | Auth |
|--------|------|------|
| POST | `/webhooks/telegram` | `X-Telegram-Bot-Api-Secret-Token` |
| POST | `/internal/jobs/:jobId/complete` | Bearer + HMAC headers |
| POST | `/internal/jobs/:jobId/fail` | Bearer + HMAC headers |
| *(Phase 3)* | `/api/jobs`, `/health*` | unchanged |

---

## Delivery row contract (Phase 5 input)

Created at job create time (`channel=telegram`, `recipient_id=<chat_id>`, `status=PENDING`).

On **successful** complete callback (same TX as job → `COMPLETED`):

- `deliveries.next_retry_at` set to now
- status remains **`PENDING`** (ready to claim)

On **terminal** job failure (max attempts / deadline / recovery):

- same: `next_retry_at = now`, status stays `PENDING` so Phase 5 can send one error message

Phase 5 delivery loop should:

1. Claim with `FOR UPDATE SKIP LOCKED` where `status=PENDING` and `next_retry_at <= now` (and lease expired/null).
2. Transition `PENDING` → `SENDING` with lease (short TX, no network inside).
3. Load job; if `COMPLETED`, R2-get `output_key` and Telegram `sendPhoto` with caption including count; if `FAILED`, `sendMessage` with sanitized error (no stack/secrets).
4. Persist `external_message_id`, `SENT` (or backoff `PENDING` / terminal `FAILED`).
5. **Never** re-queue inference / Modal because delivery failed.
6. Accept at-least-once Telegram send (duplicate messages possible on ambiguous timeout); store message id when available.

Suggested caption (success): `Found {objectCount} “{prompt}”.` (tune in implementation).

---

## Local smoke (Telegram → COMPLETED) — verified pattern

1. Modal deployed: `cd services/inference && modal deploy -m inference.modal_app`
2. `apps/api/.env`: `TELEGRAM_*`, `PUBLIC_BASE_URL=<ngrok https origin>`, `R2_*`, `CALLBACK_SHARED_SECRET`, `MODAL_TOKEN_*` for Docker
3. `docker compose up --build` (or host `npm run start:dev`)
4. setWebhook:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=${PUBLIC_BASE_URL}/webhooks/telegram" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

5. Send a photo (optional caption). Logs: `telegram_job_created` → `job_dispatched` → `job_completed`.
6. `GET /api/jobs/<id>` → `COMPLETED` + `objectCount` + `outputKey`.
7. Expect **no** result photo in chat until Phase 5.

**Compose note:** host `~/.modal.toml` is not mounted; set `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET` in `.env` for the API container.

**E2E note:** live Compose dispatcher races DB e2e claims — stop API (`docker compose stop api`) before `API_RUN_DB_E2E=1 npm run test:e2e`, then start again.

---

## Tests

```bash
cd apps/api
npm test
# callback HMAC, prompt normalize, dispatcher claim/spawn/fail paths

docker compose stop api   # avoid live dispatcher racing claims
API_RUN_DB_E2E=1 npm run test:e2e
docker compose start api
# duplicate Telegram update_id, signed complete + duplicate/stale, callback-before-ack
```

---

## Known limitations / tech debt

1. No Telegram result / terminal-error delivery (Phase 5).
2. Lease recovery does not poll Modal call status → possible duplicate GPU work.
3. Webhook handler does sync Telegram download + R2 upload (usually fine under Telegram’s timeout).
4. Host Node `<22` may warn on `modal` package engines; Docker uses Node 22.
5. Without `PUBLIC_BASE_URL`, dispatcher will not claim jobs (avoids orphan Modal runs).
6. Render deploy + always-on instance still Phase 5.
7. No delivery claim repository methods yet — only job claim/recovery helpers exist.

---

## Suggested Phase 5 entry checklist

1. **Delivery loop** (mirror dispatcher): claim pending deliveries → R2 get result → `sendPhoto` / error `sendMessage` → `SENT`/`FAILED` with backoff; persist `external_message_id`.
2. Extend `TelegramClient` with `sendPhoto` (multipart upload of result bytes).
3. Add repository methods: `claimPendingDelivery`, `markDeliverySent`, `markDeliveryRetry` / terminal fail — short TX, no network inside.
4. Deploy always-on Nest to **Render** with secrets; set Telegram webhook + `PUBLIC_BASE_URL` to Render HTTPS URL (replace ngrok).
5. Confirm Modal secret `skoka-dev` still shares `CALLBACK_SHARED_SECRET` and R2 keys with Nest.
6. Configure R2 lifecycle (~24h), spending alerts/caps, basic rate limits.
7. E2E: success delivery, delivery retry, terminal failure message, no re-inference on send failure, Nest restart mid-delivery.
8. Optional metrics: queue wait, inference latency, delivery failures (plan Phase 5 list).
9. Stop when V1 works end-to-end: photo in → result photo + count out, with documented recovery.

Do **not** start Next.js V2 (Phase 6). Do **not** put Python/SAM3 in Compose.

---

## Pointers for the Phase 5 agent

| Doc / path | Why |
|------------|-----|
| [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) § Phase 5 | Scope |
| This file | Decisions, delivery contract, local/ngrok notes |
| [`PHASE_3.md`](PHASE_3.md) | Nest layout, migrations, Supabase pooler, R2 |
| [`PHASE_2.md`](PHASE_2.md) | Modal names, HMAC, R2 keys, `skoka-dev` |
| [`apps/api/src/telegram/`](../apps/api/src/telegram/) | Webhook + client to extend |
| [`apps/api/src/orchestration/`](../apps/api/src/orchestration/) | Poller pattern |
| [`apps/api/src/jobs/jobs.repository.ts`](../apps/api/src/jobs/jobs.repository.ts) | Completion arms delivery |
| [`apps/api/.env.example`](../apps/api/.env.example) | Env names |

### Credentials checklist (gitignored `.env` — never commit)

| Secret | Where |
|--------|--------|
| Telegram bot token + webhook secret | `apps/api/.env` |
| `PUBLIC_BASE_URL` | ngrok now; Render URL in Phase 5 |
| `CALLBACK_SHARED_SECRET` | API + Modal `skoka-dev` |
| `MODAL_TOKEN_ID` / `SECRET` | Docker/Render (or `~/.modal.toml` on host) |
| R2 + Supabase | Phase 3 (already working) |
