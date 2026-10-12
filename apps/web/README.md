# Skoka web (Phase 6)

Static-export Next.js SPA for the public demo. Talks to NestJS `/web/*` with anonymous Bearer sessions.

## Local

```bash
# Terminal 1 — API (Compose or host Nest on :3000)
# Ensure apps/api/.env has CORS_ORIGINS=http://localhost:3001

# Terminal 2
cd apps/web
cp .env.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:3000
npm ci
npm run dev                  # http://localhost:3001
```

## Production build (Render Static Site `skoka-ui`)

| Setting | Value |
|---------|--------|
| Root Directory | `apps/web` |
| Build Command | `npm ci && npm run build` |
| Publish Directory | `out` |
| Env | `NEXT_PUBLIC_API_URL=https://skoka.onrender.com` |

Users open `https://skoka-ui.onrender.com`; the SPA calls the API on `https://skoka.onrender.com`.

Also set on the **API** service: `CORS_ORIGINS=https://skoka-ui.onrender.com` and configure R2 bucket CORS for the UI origin (`PUT`/`GET`/`HEAD`, `Content-Type`).
