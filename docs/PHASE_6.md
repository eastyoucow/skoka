# Phase 6 — Next.js Web Application (Public Demo)

We are implementing Phase 6 of the Skoka project: a public web interface for uploading images, running SAM3 object detection/counting, and viewing/downloading results.

The application is primarily a **public demo**, not a production SaaS product.

Keep the implementation simple, secure, and cost-efficient. Reuse the existing backend architecture and inference pipeline.

## 1. Architecture

Target architecture:

```text
Next.js (Render Static Site)
        |
        | HTTPS REST API
        v
NestJS (Render Web Service)
        |
        +---- PostgreSQL (jobs, sessions)
        |
        +---- Cloudflare R2 (private image storage)
        |
        +---- Modal (Python + SAM3 inference)
                    |
                    +---- Callback to NestJS
```

Decisions:
- Use Next.js with React and TypeScript.
- Use Tailwind CSS and shadcn/ui for UI components.
- Deploy Next.js as a **Render Static Site**.
- Configure Next.js with `output: "export"`.
- Do not use Next.js SSR, API routes, Server Actions, or other server-side features.
- NestJS remains the only backend.
- Reuse the existing NestJS jobs domain and Modal inference pipeline.
- Do not modify SAM3 processing unless absolutely necessary.
- Keep the existing monorepo structure and package management conventions.

## 2. User Interface

Build a responsive web application supporting the complete processing workflow.

### Upload screen

Users should be able to:
- Upload an image using drag-and-drop or file selection.
- Preview the selected image.
- Enter a text prompt describing objects to detect (e.g., `person`, `car`, `dog`).
- Submit the image for processing.
- See basic validation errors.

Validate supported image formats and maximum file size.

### Processing screen

After submission:
- Display the current job status.
- Show a loading/progress indicator.
- Poll the NestJS API for job status.
- Handle failed jobs and timeouts.
- Prevent accidental duplicate submissions.

Do not invent fake inference progress percentages if the backend doesn't provide them.

### Results screen

When processing completes:
- Display the original image and annotated result.
- Display the detected object count.
- Allow users to download the annotated image.
- Allow users to start another processing job.

Use short-lived signed URLs for accessing private R2 objects.

### Design

The application should look like a polished modern AI demo rather than an internal administration dashboard.

Use Tailwind CSS, shadcn/ui, responsive layouts, and clear loading, empty, error, and success states. Prioritize mobile usability. Keep the UI relatively simple; avoid unnecessary animations and complex visual effects.

## 3. Authentication and Ownership

**Do not implement user registration or login in Phase 6.**

Instead, implement anonymous browser sessions:
- NestJS creates anonymous sessions.
- Use secure, HttpOnly cookies.
- Associate uploads and jobs with sessions.
- Enforce ownership checks when retrieving job status and results.
- Users must not be able to access another session's private jobs or images.
- Sessions should have a reasonable expiration period.
- Consider cookie behavior when Next.js and NestJS are deployed on separate Render domains.
- If cross-site cookies are unreliable, propose a secure alternative before implementation.
- Do not introduce a full authentication framework unless necessary.

## 4. Direct Uploads to Cloudflare R2

Implement **presigned direct-to-R2 uploads**.

Expected workflow:

```text
1. Browser → NestJS: Request upload URL
2. NestJS: Validate upload metadata, generate unique object key,
           generate short-lived presigned PUT URL
3. Browser → R2: Upload image directly
4. Browser → NestJS: Create processing job using upload reference
5. NestJS: Verify uploaded object and session ownership,
           create job, dispatch to Modal
```

Requirements:
- Keep the R2 bucket private.
- Never expose R2 credentials to the browser.
- Generate object keys on the server.
- Use short-lived presigned URLs.
- Configure R2 CORS for the frontend domain.
- Validate file type and size.
- Prevent users from referencing arbitrary R2 objects.
- Ensure upload references cannot be reused to bypass ownership or job limits.
- Clean up abandoned uploads when practical.
- Do not introduce an additional storage service.

## 5. NestJS Web API

Extend the existing NestJS application with endpoints for the web frontend. Suggested endpoints (adapt to existing conventions):

```http
POST /web/uploads
POST /web/jobs
GET  /web/jobs/:id
GET  /web/jobs/:id/result
```

Responsibilities:
- Create and validate anonymous sessions.
- Generate presigned upload URLs.
- Verify uploads before processing.
- Create jobs using the existing jobs domain.
- Enforce ownership.
- Return job status and results.
- Generate short-lived signed download URLs.

Reuse existing services, entities, and job state transitions wherever possible. Avoid duplicating Telegram-specific or inference logic.

## 6. Idempotency

Prevent duplicate inference jobs caused by repeated submissions:
- Support an `Idempotency-Key` header when creating jobs.
- Scope idempotency keys to anonymous sessions.
- Return the existing job when the same request is retried.
- Reject reuse of the same key with a different request payload.
- Enforce idempotency at the database level, not only in memory.
- Handle concurrent requests safely.
- Do not introduce Redis solely for idempotency.

## 7. Security and Abuse Prevention

Because this will be a public demo, implement reasonable protection against abuse and unnecessary GPU costs:
- Rate-limit job creation.
- Limit concurrent jobs per anonymous session.
- Validate uploaded images and restrict file size.
- Keep R2 objects private.
- Use short-lived signed result URLs.
- Restrict CORS to approved frontend origins.
- Validate session ownership for all private resources.
- Never expose Modal, R2, or other backend credentials to the browser.
- Avoid exposing internal error details.
- Consider Cloudflare Turnstile as optional additional protection.
- Do not introduce complicated authentication or anti-abuse infrastructure unless justified.

## 8. Deployment

Deploy the frontend to **Render Static Site**.

Next.js configuration:

```typescript
const nextConfig = {
  output: "export",
};
export default nextConfig;
```

Use a build-time environment variable:

```dotenv
NEXT_PUBLIC_API_URL=https://your-api.onrender.com
```

Requirements:
- Support local development against the existing Docker Compose environment.
- Document frontend build and deployment process.
- Configure CORS in NestJS.
- Document R2 CORS configuration.
- Keep environment variables separate for local development and production.
- Do not introduce Docker for the frontend unless there is a clear reason.
- Ensure compatibility with the existing monorepo and CI/CD setup.

## 9. Testing

### Functional tests
- Successful image upload and inference.
- Invalid file format.
- Oversized image.
- Failed R2 upload.
- Failed Modal inference.
- Job status polling.
- Result download.
- Expired signed URLs.

### Security tests
- Accessing another session's job.
- Accessing another session's result.
- Reusing upload references.
- Duplicate job submissions.
- Concurrent submissions.
- Rate-limit enforcement.

### Browser tests
- Desktop layout.
- Mobile layout.
- Drag-and-drop upload.
- File picker upload.
- Browser refresh during processing.
- Cross-origin requests and session cookies.

Use mocked Modal inference where appropriate. Include at least one real end-to-end integration test.

## 10. Constraints

- No user registration or login.
- No payments.
- No user dashboard or job history page.
- No SSR.
- No additional backend framework.
- No Redis unless an existing component requires it.
- No changes to SAM3 model or inference logic.
- No unnecessary abstractions or infrastructure.
- Keep operational costs low.

## 11. Implementation Process

**Before writing code:**
1. Inspect the existing repository and architecture documentation.
2. Review the current NestJS jobs domain, database schema, R2 integration, Modal dispatch, and callback handling.
3. Identify components that can be reused.
4. Identify necessary database migrations.
5. Evaluate cross-origin anonymous session handling for Render Static Site + Render Web Service.
6. Propose an implementation plan divided into manageable steps.
7. Highlight architectural decisions or security concerns that require clarification.

**Do not start implementation until the plan has been reviewed.**

## Definition of Done

Phase 6 is complete when:
- A user can open the public Skoka website without registering.
- Upload an image and enter a detection prompt.
- Submit a processing job.
- Track processing status.
- View the detected object count and annotated result.
- Download the result.
- All images remain private in R2.
- Users cannot access other sessions' jobs.
- Duplicate submissions don't create duplicate inference jobs.
- The frontend works on desktop and mobile.
- The frontend is deployed to Render Static Site.
- The existing Telegram workflow continues working.
- No changes to SAM3 inference are required.

## Suggested Milestones

**Phase 6A — Functional Web MVP:** Next.js UI, NestJS endpoints, direct R2 uploads, polling, and results. Anonymous sessions and basic ownership protection must already be included.

**Phase 6B — Public Deployment & Hardening:** Rate limiting, concurrent-job limits, security testing, browser testing, and Render deployment.

**Planning priority:** Challenge anonymous session handling across Render domains before implementation; this may be more difficult than the Next.js interface itself.

---

## Implementation handoff (locked)

### Decisions

| Topic | Choice |
|-------|--------|
| Sessions | Bearer token in `sessionStorage`; Nest stores SHA-256 hash only; 24h TTL |
| Hosts | Separate Render services — API `https://skoka.onrender.com`, UI Static Site `skoka-ui` (`https://skoka-ui.onrender.com`) |
| Cookies | Not used (cross-site `*.onrender.com`) |
| Turnstile | Not in v1; hook comment on `POST /web/jobs` |
| Global GPU concurrency | Existing `DISPATCHER_MAX_CONCURRENT` (default 2) |
| Per-session concurrency | `WEB_MAX_CONCURRENT_JOBS_PER_SESSION` (default 1) |

### Nest endpoints

- `POST /web/sessions` → `{ token, expiresAt }`
- `POST /web/uploads` (Bearer) → `{ uploadId, putUrl, headers, expiresAt }`
- `POST /web/jobs` (Bearer + `Idempotency-Key`) → public job DTO
- `GET /web/jobs/:id` / `GET /web/jobs/:id/result` — session ownership

### Schema

Migration `1760300000000-WebSessionsUploads`: `web_sessions`, `web_uploads`, `web_job_requests`.

Telegram delivery claim/arm filtered to `channel = telegram` so WEB deliveries are never sent via Telegram.

### Frontend

[`apps/web`](../apps/web) — Next.js `output: "export"`, Tailwind SPA on `/`.

### Ops checklist

1. Deploy API with new migration (`RUN_MIGRATIONS=true`).
2. Set API `CORS_ORIGINS=https://skoka-ui.onrender.com` (and `http://localhost:3001` for local).
3. Render Static Site `skoka-ui`: root `apps/web`, build `npm ci && npm run build`, publish `out`, `NEXT_PUBLIC_API_URL=https://skoka.onrender.com`.
4. R2 bucket CORS: allow UI origin, methods `PUT`/`GET`/`HEAD`, header `Content-Type`.
5. Smoke: open UI → upload → poll → download; confirm Telegram still works.

### Known limits

- Rate limits are in-process memory (single Render instance).
- `sessionStorage` clears when the browser session ends; XSS can read the token (acceptable for public demo).
- Unauthenticated `GET/POST /api/jobs` disabled in production.
