# Phase 2 — Modal SAM3 inference + R2 + callback client (handoff)

Status: **complete enough to start Phase 3** (NestJS + Postgres + local Docker).  
Inference runs on Modal with Cloudflare R2 I/O. NestJS callback HTTP endpoints are **not** implemented yet (**Option B**): the Python callback client and full contract are ready; unit tests mock HTTP.

Full product plan: [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).  
Phase 1 library contract: [`PHASE_1.md`](PHASE_1.md).

---

## Decisions locked in Phase 2

| Topic | Decision |
|-------|----------|
| Callbacks | **Option B** — implement signed Python client + mock in tests; **no** temporary public webhook / Modal web endpoint for callbacks |
| NestJS receiver | Deferred to Phase 4 (wire auth + idempotency then) |
| Storage | Real Cloudflare R2 via boto3 S3 API; **no MinIO** |
| Modal secrets | **One** secret named `skoka-dev`, created from gitignored `services/inference/.env.modal` |
| Docker / NestJS image | **Deferred to Phase 3**; Python/SAM3 stays out of Compose forever in V1 |
| Modal invocation | Deployed app `skoka-inference`, function `run_job`; NestJS will use `Function.from_name(...).spawn(...)` and store `call.object_id` as `modal_call_id` |
| GPU (initial) | `T4`, `memory=8192`, `timeout=600`, `min_containers=0`, `max_containers=2` |
| Callback auth | Bearer `CALLBACK_SHARED_SECRET` **plus** HMAC-SHA256 headers (see contract below) |
| R2 access from Modal | Direct scoped credentials in secret (not signed URLs for the worker) |
| Env files | `.env` (local CLI), `.env.modal` (Modal secret source) — both gitignored; only `.env.example` committed |

---

## Repository shape after Phase 2

```
skoka/
├── README.md
├── .gitignore                 # ignores .env, .env.*, keeps .env.example
├── docs/
│   ├── IMPLEMENTATION_PLAN.md
│   ├── PHASE_1.md
│   └── PHASE_2.md             ← this file
└── services/inference/
    ├── pyproject.toml         # + boto3, httpx; optional modal via [deploy]/[dev]
    ├── .env.example           # placeholders only
    ├── .env / .env.modal      # gitignored — never commit
    ├── README.md
    ├── src/inference/
    │   ├── segment.py / render.py / model.py / …  # Phase 1 (unchanged contract)
    │   ├── storage.py         # R2 download/upload
    │   ├── callback.py        # signed complete/fail client
    │   ├── job.py             # R2 → SAM3 → R2 → callback
    │   └── modal_app.py       # Modal App + run_job + local_entrypoint
    └── tests/
        ├── test_callback.py
        ├── test_storage.py
        └── test_job.py
```

No `apps/` NestJS yet. No Docker Compose yet.

---

## What was implemented

| Piece | Path | Behavior |
|-------|------|----------|
| R2 storage | `storage.py` | `R2Config.from_env()`, `download_bytes`, `upload_bytes`; endpoint from `R2_ENDPOINT` or derived from `R2_ACCOUNT_ID` |
| Callback client | `callback.py` | `CallbackClient.complete` / `.fail`; Bearer + HMAC; retries on 5xx/network/429 |
| Job runner | `job.py` | `JobPayload` + `run_job(...)` orchestration; maps errors to stable codes |
| Modal app | `modal_app.py` | CUDA image (torch cu124 wheels + pinned ML deps); secret `skoka-dev`; forces `device_preference="cuda"` |
| Tests | `test_*.py` | Mocked HTTP (`httpx.MockTransport`) + mocked boto3; default `pytest` = 42+ unit tests, no HF/R2/NestJS |

Phase 1 `segment` / `render` / `load_model` reused as-is (no product logic rewrite).

---

## Ops: secrets and deploy

Do **not** commit credentials. Local: `services/inference/.env`. Modal source: `services/inference/.env.modal`.

### Create / update Modal secret

Editing `.env.modal` alone does **not** update Modal. Always push:

```bash
cd services/inference
source .venv/bin/activate
modal secret create skoka-dev --from-dotenv .env.modal --force
modal deploy -m inference.modal_app   # recommended after secret or code changes
```

Threshold / model env changes (`SAM3_SCORE_THRESHOLD`, etc.) live in the secret — no image rebuild required; redeploy (or drain warm containers) so new values apply.

### Deploy and smoke

```bash
modal deploy -m inference.modal_app

# Upload a private object to R2 first, then:
modal run -m inference.modal_app \
  --input-key jobs/smoke/input.jpg \
  --prompt person \
  --callback-url https://example.invalid
```

`https://example.invalid` is expected to fail the **callback** step after R2 upload. Verify success by checking the `outputKey` object in the R2 bucket. There is **no** public HTTP/`curl` entrypoint for `run_job` (by design); invoke via `modal run`, `modal.Function.from_name(...).remote/.spawn`, or NestJS later.

### Cloud prerequisites (manual)

1. **Hugging Face** — gated access to `facebook/sam3` + `HF_TOKEN`
2. **Cloudflare R2** — private bucket (e.g. `skoka-dev`), S3 API keys, ~24h lifecycle delete
3. **Modal** — workspace auth (`modal token new`); secret `skoka-dev` with keys from `.env.example`

---

## Modal invocation contract (NestJS Phase 4)

- **App:** `skoka-inference`
- **Function:** `run_job`
- **Secret:** `skoka-dev`

```python
import modal

fn = modal.Function.from_name("skoka-inference", "run_job")
call = fn.spawn({
    "jobId": "...",
    "attemptId": "...",
    "inputKey": "jobs/{jobId}/input.jpg",
    "prompt": "person",
    "outputKey": "jobs/{jobId}/attempts/{attemptId}/result.png",
    "callbackUrl": "https://<nestjs-host>",  # API origin only, no path
})
# Persist call.object_id as job_attempts.modal_call_id
```

Never put secrets in the payload. Worker return value (if polled):  
`{ok, count, outputKey, errorCode, errorMessage}` — NestJS should treat the **HTTP callback** as the durable completion signal.

### R2 key layout

- Input: `jobs/{jobId}/input.<ext>`
- Output: `jobs/{jobId}/attempts/{attemptId}/result.png`

---

## NestJS callback contract (implement server in Phase 4)

Base URL = `callbackUrl` from the Modal payload (API origin).

| Method | Path | JSON body |
|--------|------|-----------|
| POST | `/internal/jobs/{jobId}/complete` | `attemptId`, `count`, `outputKey` |
| POST | `/internal/jobs/{jobId}/fail` | `attemptId`, `code`, `message` |

### Authentication (Python client already sends)

1. `Authorization: Bearer <CALLBACK_SHARED_SECRET>`
2. `X-Skoka-Timestamp`: unix seconds (string)
3. `X-Skoka-Signature`: hex HMAC-SHA256 of `timestamp + "." + raw_body` with the same secret

NestJS must reject timestamp skew greater than 5 minutes. Share the **same** `CALLBACK_SHARED_SECRET` with Modal secret `skoka-dev` and NestJS env.

### Failure codes (stable strings)

`INPUT_NOT_FOUND` | `IMAGE_INVALID` | `INFERENCE_ERROR` | `UPLOAD_FAILED` | `CALLBACK_FAILED` | `UNKNOWN`

### Retry (Python) / idempotency (NestJS)

- Client: up to `CALLBACK_MAX_RETRIES` (default 3), exponential backoff; retry 5xx / network / 429; no retry on other 4xx.
- Delivery is **at-least-once**. NestJS must accept only the **active** `attemptId`, return 2xx on duplicates without side effects, and never regress `COMPLETED` → `PROCESSING`.

Reference implementation: [`services/inference/src/inference/callback.py`](../services/inference/src/inference/callback.py).

---

## Latency / cost

| Metric | Value | Notes |
|--------|-------|-------|
| GPU SKU | T4 (initial) | Change in `modal_app.py` after benchmarks if VRAM/speed insufficient |
| Cold start | Measure on first real runs | Model download + load dominates |
| Warm inference | Measure | |
| Cost / image | Modal dashboard | `min_containers=0` → cheap idle, cold starts on low traffic |

Fill concrete numbers when available; not a blocker for Phase 3.

---

## Known limitations / tech debt

1. No live NestJS callback server; smoke with invalid callback URL fails after successful R2 write.
2. No Modal HTTP/`curl` submit API — intentional until NestJS owns orchestration.
3. T4 / 8 GiB may be tight for SAM3 — re-benchmark before production load.
4. Latency/cost table incomplete until measured.
5. Image size/format policy and threshold quality tuning still open (Phase 0 leftovers).
6. Docker Compose not started — full requirements in plan § **Local Docker development (from Phase 3)**.

---

## What Phase 3 must know / reuse

### Reuse as-is

- Do **not** reimplement SAM3 or overlays in NestJS; keep calling Modal `run_job`.
- Mirror R2 key layout and env var names from [`services/inference/.env.example`](../services/inference/.env.example) on the API side (`R2_*`, later `CALLBACK_SHARED_SECRET`).
- Implement NestJS R2 adapter with `@aws-sdk/client-s3` against the **same** private bucket (no MinIO).
- Plan jobs/attempts/deliveries schema so `modal_call_id`, `active_attempt_id`, and callback fields match this contract.
- Ship **local Docker Compose**: NestJS (hot reload) + Postgres 17 + volume + healthcheck + migrations in API container + `docker compose up --build`. Python stays outside Compose.

### Do not assume

- Do not assume Modal callbacks hit NestJS yet — Phase 3 can persist jobs and upload to R2 without wiring Modal dispatch (that is Phase 4).
- Do not add a public callback receiver “for testing” that weakens auth.
- Do not commit `.env` / `.env.modal` or real credentials.
- Do not containerize `services/inference`.

### Suggested Phase 3 entry checklist

1. Scaffold NestJS under `apps/` (or path agreed in plan); service-local `.env.example`.
2. Add Docker Compose per plan (Postgres 17, API Dockerfile hot reload, healthcheck, volume, migrations).
3. TypeORM migrations for `jobs` / `job_attempts` / `deliveries` (see plan data model).
4. R2 upload/download adapter + health endpoint; create job + store `input_key`.
5. Keep Modal/callback wiring for Phase 4; document shared `CALLBACK_SHARED_SECRET` when NestJS env is created.
6. Stop when Compose works and jobs persist across restart.

### Pointers for the next agent

| Doc / path | Why |
|------------|-----|
| [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) § Phase 3 + Local Docker | Scope and Compose requirements |
| [`PHASE_1.md`](PHASE_1.md) | `segment` / `render` library contract |
| This file | Modal names, secrets, callback/R2 contracts, decisions |
| [`modal_app.py`](../services/inference/src/inference/modal_app.py) | Deploy unit + `SECRET_NAME = "skoka-dev"` |
| [`callback.py`](../services/inference/src/inference/callback.py) | Exact headers/HMAC NestJS must verify |
| [`job.py`](../services/inference/src/inference/job.py) | Payload shape and error codes |
| [`services/inference/.env.example`](../services/inference/.env.example) | Env var names |
