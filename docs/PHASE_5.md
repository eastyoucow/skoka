# Phase 5 — Delivery, Render deploy, hardening (handoff)

Status: **complete — V1 end-to-end path implemented**; ops steps (Render env, webhook cutover, R2 lifecycle, spend caps) require dashboard actions listed below.

Full product plan: [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).  
Phase 4 (Telegram → Modal → `COMPLETED`): [`PHASE_4.md`](PHASE_4.md).

---

## What landed in code

| Area | Detail |
|------|--------|
| Delivery loop | `DeliveryService` — `setInterval` + `SKIP LOCKED` claim → R2 get / error text → Telegram → `SENT` / backoff |
| Telegram | `sendPhoto` (multipart) + `sendText` (throws, returns `message_id`); UX `sendMessage` still fire-and-forget |
| Repository | `claimPendingDelivery`, `markDeliverySent`, `markDeliveryRetryOrFail`, `recoverExpiredDeliveryLeases`; stale `RECEIVED` now arms deliveries |
| Recovery | Also reclaims expired `SENDING` delivery leases after Nest crash mid-send |
| Rate limit | In-memory per-IP guard on `POST /webhooks/telegram` (`RATE_LIMIT_TELEGRAM_PER_MINUTE`, default 60) |
| Metrics | Structured logs `{ msg: "metric", metric: "..." }` for dispatch queue wait, delivery sent/retry/failed |
| Render | [`render.yaml`](../render.yaml) + [`apps/api/Dockerfile.prod`](../apps/api/Dockerfile.prod) |

**Done when (product):** photo in → result photo + count out on Telegram, with always-on Nest and bounded costs. Code path is ready; production cutover is the remaining human checklist.

---

## Delivery contract (locked)

1. Claim `PENDING` where `next_retry_at <= now` and lease null/expired (`FOR UPDATE SKIP LOCKED`).
2. Short TX: `PENDING` → `SENDING`, `attempts++`, set `lease_until`.
3. Outside TX: load job.
   - `COMPLETED` → R2 `getObject(output_key)` → `sendPhoto` caption `Found {n} “{prompt}”.` (incl. `0`)
   - `FAILED` → `sendText` sanitized apology (no stacks/secrets)
4. Persist `external_message_id` + `SENT`, or backoff to `PENDING`, or terminal delivery `FAILED` after `DELIVERY_MAX_ATTEMPTS`.
5. **Never** re-queue Modal because Telegram send failed.
6. At-least-once Telegram send is acceptable on ambiguous timeouts.

Defaults: lease 60s, max 5 attempts, backoff `10s * attempts`, poll 2s, max concurrent 4.

---

## Render deployment (do this in the dashboard)

### A. Create / sync the Web Service

**Live service (operator):** `srv-db52chijnfac7390f4ag` → `https://skoka.onrender.com` (currently **Oregon**).  
Supabase is **eu-west-1**; R2 is Eastern Europe. Oregon↔EU adds DB/storage RTT. Render **cannot** change region in place — recreate in **Frankfurt** later if latency hurts; Blueprint `region` is set to `frankfurt` for new services.

1. Push Phase 5 to the branch Render auto-deploys, and ensure the service builds from:
   - **Dockerfile path:** `apps/api/Dockerfile.prod`
   - **Docker context:** `apps/api`
   - **Plan:** paid always-on (`starter` or higher) — free instances sleep and break in-process pollers
   - **Health check path:** `/health`
   - **Instances:** `1` for V1

2. Set **secret** env vars in Render (Dashboard → Environment). Values come from your local `apps/api/.env` / existing cloud consoles — **do not paste them into git**.

| Variable | Source / notes |
|----------|----------------|
| `DATABASE_URL` | Supabase **session pooler** `postgresql://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:5432/postgres` |
| `DATABASE_SSL` | `true` (Blueprint sets this) |
| `PUBLIC_BASE_URL` | `https://<your-service>.onrender.com` (no trailing slash, no path) — set **after** first deploy URL is known, then restart |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` / `R2_ENDPOINT` | Same private bucket as Modal |
| `CALLBACK_SHARED_SECRET` | **Identical** to Modal secret `skoka-dev` |
| `TELEGRAM_BOT_TOKEN` | BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Random long string; same value used in `setWebhook` |
| `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET` | `modal token new` / Modal dashboard (required in prod — no `~/.modal.toml`) |
| `MODAL_APP_NAME` / `MODAL_FUNCTION_NAME` | Defaults `skoka-inference` / `run_job` |

Optional tuning (defaults are fine): `DELIVERY_*`, `DISPATCHER_*`, `JOB_*`, `RATE_LIMIT_TELEGRAM_PER_MINUTE`.

3. Deploy and confirm:
   - `GET https://<service>/health` → `{ "status": "ok" }`
   - `GET https://<service>/health/ready` → Postgres OK
   - Logs show Dispatcher / Recovery / Delivery started

### B. Point Telegram + Modal at Render

Prod origin for this project:

```bash
export PUBLIC_BASE_URL="https://skoka.onrender.com"
# Load TELEGRAM_* from apps/api/.env (do not commit)
set -a && source apps/api/.env && set +a

curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=${PUBLIC_BASE_URL}/webhooks/telegram" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"

curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

Expected: `GET https://skoka.onrender.com/health` → `{"status":"ok"}` **before** setWebhook.

- Modal callbacks use `PUBLIC_BASE_URL` from Nest when spawning — set it on Render, then **restart** once.
- Modal secret `skoka-dev` must still include the same `CALLBACK_SHARED_SECRET` and R2 credentials (Phase 2). Confirmed by operator.

### C. Cut over from ngrok

1. Render env: `PUBLIC_BASE_URL=https://skoka.onrender.com` (no trailing slash).
2. Deploy Phase 5; wait until `/health` and `/health/ready` are 200.
3. `setWebhook` (above); stop ngrok / local API.
4. Send a Telegram photo; expect ack → result photo with count.

---

## Ops checklist (outside Nest code)

| Item | Action |
|------|--------|
| R2 lifecycle | Cloudflare → R2 bucket → Settings → Object lifecycle: delete after **~24h**. Keep `JOB_DEADLINE_HOURS` (default 12) below retention. |
| Supabase backups | Enable PITR / daily backups appropriate to your tier; retention for job metadata ~7–30 days is enough for V1. |
| Modal spend | Set a workspace spending limit / alerts in Modal dashboard (GPU cost dominates). |
| Render spend | Paid always-on instance; watch autoscaling (keep `numInstances: 1` unless you intentionally scale). |
| Cloudflare / R2 | Optional request metrics alerts on the bucket. |
| Rate limits | Code: webhook IP limit. Telegram also rate-limits Bot API outbound. |

---

## Local smoke (full V1)

1. Modal deployed: `cd services/inference && modal deploy -m inference.modal_app`
2. `apps/api/.env` with Telegram, R2, callback secret, `PUBLIC_BASE_URL=<ngrok>`, `MODAL_TOKEN_*` for Docker
3. `docker compose up --build`
4. `setWebhook` to ngrok `/webhooks/telegram`
5. Send photo → ack message → **result photo** with `Found N “prompt”.`
6. Force a bad Modal/R2 failure path → user gets sanitized failure text once (delivery `SENT`)

---

## Tests

```bash
cd apps/api
npm test
# includes delivery.service.spec (success / failure notice / retry without Modal)

docker compose stop api
API_RUN_DB_E2E=1 npm run test:e2e
docker compose start api
# completion arms delivery; delivery send + retry-without-redispatch
```

---

## Known limitations

1. Duplicate Telegram messages possible on ambiguous `sendPhoto` timeout (at-least-once).
2. Lease recovery still does not poll Modal call status → possible duplicate GPU work.
3. Rate limiter is in-process memory (fine for single Render instance).
4. Metrics are structured logs only (no Prometheus yet); cold/warm inference timing remains Modal-side.
5. Cost-per-image is not computed in Nest — use Modal billing + job counts from logs.

---

## Credentials to provide / confirm (ask operator)

If deploying now, confirm these exist (values stay in Render / Modal / local `.env` only):

1. Render account access + chosen region/plan  
2. Supabase session-pooler `DATABASE_URL`  
3. R2 scoped keys (same as Modal)  
4. `CALLBACK_SHARED_SECRET` shared with Modal `skoka-dev`  
5. `TELEGRAM_BOT_TOKEN` + chosen `TELEGRAM_WEBHOOK_SECRET`  
6. `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET`  
7. Whether R2 lifecycle (~24h) is already configured  

---

## Phase 6 boundary

Do **not** start Next.js V2 here. Web auth, presigned uploads, and browser polling are Phase 6.
