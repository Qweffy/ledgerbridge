# Deploy

Three pieces: the **API** (Fastify + worker + reconciler) on **Railway**, the **web** dashboard on
**Vercel**, and **Neon** for Postgres. The worker and reconciler are continuous poll loops, so the API must
run on a **persistent** host (Railway) — not a serverless function.

The two URLs depend on each other (CORS + the API base URL), so deploy is iterative: create each service,
grab its public URL, then fill the cross-host vars and redeploy.

## 0. Database (Neon)
Reuse the existing Neon project — it's already migrated, and its `oauth_tokens` already hold valid sandbox
tokens, so the deployed API needs no re-OAuth (it auto-refreshes). Have the pooled `DATABASE_URL` handy.

## 1. API → Railway
1. New project → **Deploy from GitHub repo** → pick this repo. Railway detects the root **`Dockerfile`** and
   builds the API image. (No start command needed — the Dockerfile's `CMD` runs `db:migrate` then `start`.)
2. Add the environment variables (see the matrix below). Leave `<api>`/`<web>` blank for now — set them once
   the URLs exist.
3. Deploy. Under **Settings → Networking**, generate a public domain → this is `‹api›`
   (e.g. `https://ledgerbridge-api.up.railway.app`). Railway injects `PORT`; the server reads it.
4. Check the deploy logs for **`sync worker + reconciler started`** and hit `‹api›/health` → `{"status":"ok"}`.

## 2. Web → Vercel
1. New project → import this repo. Set **Root Directory = `apps/web`** (and enable "Include files outside the
   root directory" so the workspace + `@ledgerbridge/shared` resolve). Framework: **Next.js** (auto). No
   `vercel.json` needed — `transpilePackages` already covers the shared package.
2. Env var: `NEXT_PUBLIC_API_URL = ‹api›` (the Railway URL). `NEXT_PUBLIC_*` is inlined at build time, so a
   **redeploy** is required after changing it.
3. Deploy → the production domain is `‹web›` (e.g. `https://ledgerbridge.vercel.app`).

## 3. Wire the two together (then redeploy each)
- **Railway** → set `WEB_ORIGIN = ‹web›`, `QBO_REDIRECT_URI = ‹api›/oauth/callback`,
  `INTERNAL_WEBHOOK_TARGET = ‹api›/webhooks/internal` → redeploy.
- **Vercel** → confirm `NEXT_PUBLIC_API_URL = ‹api›` → redeploy.
- **Intuit Developer app** → add `‹api›/oauth/callback` to the app's **Redirect URIs**. (Re-OAuth only if the
  refresh token has lapsed; reusing the Neon means the existing realm tokens already work.)

## 4. Verify
Open `‹web›` → the top-bar shows **Live** (not Mock). Drive the **Demo** panel end-to-end: Create invoice →
**Events** reaches `done`; Edit in both → **Conflicts** opens → resolve; Inject fault → **Events**
dead-letters → replay; Run reconciler. Browser console clean.

## Environment matrix

| Variable | Railway (API) | Vercel (web) | Value |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | the Neon pooled URL |
| `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` | ✅ | — | Intuit app keys |
| `QBO_ENVIRONMENT` | ✅ | — | `sandbox` |
| `QBO_REALM_ID` | ✅ | — | connected sandbox company id |
| `QBO_DEFAULT_CUSTOMER` / `QBO_DEFAULT_ITEM` | ✅ | — | the mapped QBO Customer + Item |
| `QBO_REDIRECT_URI` | ✅ | — | `‹api›/oauth/callback` |
| `INTERNAL_WEBHOOK_SECRET` | ✅ | — | the HMAC key |
| `INTERNAL_WEBHOOK_TARGET` | ✅ | — | `‹api›/webhooks/internal` |
| `WEB_ORIGIN` | ✅ | — | `‹web›` (CORS allow-origin) |
| `PORT` | — (injected) | — | Railway sets it |
| `NEXT_PUBLIC_API_URL` | — | ✅ | `‹api›` |

Secrets are entered in each platform's dashboard — they never live in the repo (`.env*` is gitignored and
`.dockerignore`d).
