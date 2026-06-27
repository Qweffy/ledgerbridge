# LedgerBridge

Two-way invoice sync between an internal invoicing system and **QuickBooks Online** (QBO), built to
survive the messiness of real integrations: duplicate, delayed and out-of-order events, incomplete
webhook payloads, and partial failures.

Two ideas carry the whole design:

1. **A webhook is a ping, not the truth.** Every event triggers a **refetch** of the current state
   from the source before anything is applied — which neutralises out-of-order and incomplete
   payloads in one move.
2. **Every write is idempotent.** Reprocessing the same event N times yields the same result: no
   duplicate records, no repeated writes.

## Live demo

- **Dashboard** — https://ledgerbridge-web.vercel.app *(Vercel)*
- **API** — https://ledgerbridgeapi-production.up.railway.app *(Railway; Fastify + the sync worker & reconciler)* — health at [`/health`](https://ledgerbridgeapi-production.up.railway.app/health), live counts at [`/status`](https://ledgerbridgeapi-production.up.railway.app/status)

Open the dashboard's **Demo** panel to drive the whole pipeline against a real QBO sandbox (create → sync →
edit-both → conflict → resolve → inject-fault → dead-letter → replay → reconcile). If the API is
unreachable the dashboard falls back to mock fixtures, so the UI is always explorable.

## Status

Built and tested so far:

- **Monorepo** — npm workspaces: `apps/api` (Fastify), `apps/web` (Next.js), `packages/shared`.
- **Design system** — the LedgerBridge component library (tokens + 13 primitives) ported into
  `apps/web` with a `/design` gallery, dark + light.
- **Data model** — `links`, `sync_events` (outbox/inbox), `audit_log`, `oauth_tokens` + a
  `dead_letter` view, with checked-in migrations.
- **Internal system (simulated)** — `internal.*` invoices/payments/changes + a `/internal/*` API
  that emits **HMAC-signed change webhooks** (money is integer cents).
- **QBO OAuth2** — `/oauth/connect` + `/oauth/callback`, tokens stored in `oauth_tokens` with
  auto-refresh; a thin Accounting API client (create / read / sparse-update / void invoice).
- **Sync core (internal → QBO)** — signed-webhook ingest → durable outbox **worker** with a
  `FOR UPDATE SKIP LOCKED` lease → **idempotent apply** (check-by-external-id before create) →
  `links` + `audit_log`, with exponential-backoff retries, dead-lettering, and graceful shutdown.
- **Reverse sync (QBO → internal) + loop prevention** — a `/webhooks/qbo` receiver (Intuit HMAC
  verify + Change-Data-Capture parse) feeds the same outbox; the reverse processor refetches the QBO
  invoice and applies it to the internal system. Two complementary guards keep the two directions
  from ping-ponging: our own write-back is recognised by the QBO **`SyncToken`** we recorded, and the
  internal-side echo it triggers is recognised by the state **hash** — so a change made in one system
  lands in the other exactly once.
- **Conflict handling (edited in both)** — each link keeps the **last-synced snapshot**; before
  applying, both sides are diffed against it. A **same-field divergence** (both moved the amount,
  differently) flags `status='conflict'` and **holds both directions** — no clobber — until an
  operator resolves it (`resolveConflict`); disjoint-field edits apply independently and identical
  edits converge. Flag-and-hold rather than cross-clock last-write-wins, so a real change is never
  silently dropped (see DESIGN.md).
- **Payments** — an internal payment syncs as a real QBO **`Payment`** with a `LinkedTxn` to the
  invoice (so QBO's invoice Balance reflects it). Idempotent two ways: a `payment` link row
  (skip if already synced) and a stable `Request-Id` (Intuit dedups a retried create — Payments have
  no `DocNumber`). The reverse (a payment entered in QBO → internal) is deliberately deferred.
- **Reconciler (the safety net)** — a periodic pass that **matches** invoices existing on both sides
  with no link (by DocNumber + amount; ambiguity or a mismatch is flagged, never blindly linked) and
  **recovers drift** from dropped webhooks: it refetches both sides and, when a version/hash has moved
  past what we last synced, enqueues a **synthetic event** into the same idempotent outbox so the
  worker re-converges the state. Skips anything the worker already has in flight; writes one heartbeat
  audit row per pass. (Per-link refetch here; QBO's CDC endpoint is the production scale path.)
- **Admin / observability API** — a read API over the engine's state (`/status` with event counts +
  oldest-pending lag + dead-letter/conflict counts + last-reconcile; `/events`, `/links`,
  `/conflicts`, `/audit`, each with detail routes) plus two operator actions: **`/conflicts/:id/resolve`**
  (pick a winner) and **`/events/:id/replay`** (re-queue a dead-letter). The response contract lives as
  zod schemas in `packages/shared`, so the dashboard consumes it type-safely — it's a one-env-var swap
  from the mock client to the real API.
- **Operator dashboard + landing (`apps/web`)** — a Next.js dashboard over the admin API: Overview (live
  counts + event feed), Invoices with a field-level internal-vs-QBO diff, a Conflicts queue with one-click
  resolve, an Events log with dead-letter replay, an Audit time-travel log, and a **Demo control panel**
  that drives the engine live — plus a marketing landing page. It renders on mock fixtures out of the box;
  one env var (`NEXT_PUBLIC_API_URL`) points it at the live API.

The whole pipeline is **verified end-to-end against the real QBO sandbox**, driven from the Demo panel:
create an invoice → it syncs internal→QBO → edit it on both sides → a conflict opens → resolve it → inject
a fault → the event dead-letters → replay it. Forward and reverse directions (including the no-loop round
trip) are additionally covered by **66 deterministic tests** on an in-process Postgres with a mocked QBO
boundary.

## Architecture

```
Internal system  ──signed webhook──▶ ┌───────────────────────────────┐ ──API write──▶ QuickBooks Online
   (/internal/*)                      │  ingest → outbox → worker      │                 (OAuth2, sandbox)
                 ◀──refetch+apply──   │  verify · dedupe · enqueue     │ ◀──CDC webhook──
                                      │  refetch → map → apply → audit │
                                      └───────────────┬───────────────┘
                                                      │ read / write
                              ┌──────────┬────────────┴───────────┬──────────────┐
                              │  links   │      sync_events        │  audit_log   │   + oauth_tokens
                              └──────────┴─────────────────────────┴──────────────┘
       loop prevention: QBO SyncToken (inbound echo) + state hash (internal echo)
```

## Stack

- **TypeScript** across the board.
- **apps/api** — Fastify, Drizzle ORM + Postgres (Neon), Zod at every boundary, Vitest.
- **apps/web** — Next.js 16 (App Router) + Tailwind CSS v4 (CSS-first `@theme`) + shadcn/ui +
  lucide-react.
- **packages/shared** — Zod schemas and types shared by the API and the web app.

## Layout

```
apps/
  api/    # Fastify: internal system, OAuth, ingest, sync worker, reconciler, admin API. Drizzle + db/.
  web/    # Next.js: landing page (/) + operator dashboard (/dashboard) + design gallery (/design).
packages/
  shared/ # canonical enums, types, status vocabulary, and the admin-API DTO schemas.
```

## Getting started

Requirements: Node 22+, a Postgres database (a free [Neon](https://neon.tech) project works), and an
[Intuit Developer](https://developer.intuit.com) app with a QBO **sandbox** company.

```bash
npm install
```

Create `apps/api/.env.local` from the example and fill it in:

```bash
cp apps/api/.env.example apps/api/.env.local
```

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Postgres connection string (Neon pooled). |
| `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` | Intuit app Development keys. |
| `QBO_REDIRECT_URI` | Must match a Redirect URI registered on the app (e.g. `http://localhost:3001/oauth/callback`). |
| `QBO_ENVIRONMENT` | `sandbox` or `production`. |
| `QBO_REALM_ID` | The connected sandbox company id (from the OAuth callback). |
| `QBO_DEFAULT_CUSTOMER` / `QBO_DEFAULT_ITEM` | The QBO Customer + Item the bridge maps internal invoices onto. |
| `INTERNAL_WEBHOOK_SECRET` | HMAC key the simulated internal system signs its webhooks with. |
| `INTERNAL_WEBHOOK_TARGET` | Where the internal system posts change webhooks (the bridge ingest, e.g. `http://localhost:3001/webhooks/internal`). |
| `PORT` | API port (default `3001`). |
| `WEB_ORIGIN` | Allowed browser origin(s) for the dashboard, comma-separated (CORS; default `http://localhost:3000`). |

> The sync worker only starts when `QBO_REALM_ID`, `QBO_DEFAULT_CUSTOMER` and `QBO_DEFAULT_ITEM` are
> set (otherwise the API runs without it and logs a warning).

Apply the migrations, then run the two dev servers (in separate terminals):

```bash
npm run db:migrate -w @ledgerbridge/api   # create the schema
npm run dev:api                            # Fastify on :3001 (ingest + sync worker + reconciler)
npm run dev:web                            # Next.js on :3000 (landing + dashboard + /design)
```

Connect a QBO sandbox by opening <http://localhost:3001/oauth/connect> and authorising the app.

The dashboard renders on **mock fixtures** by default. To point it at the live local API, create
`apps/web/.env.local` with `NEXT_PUBLIC_API_URL=http://localhost:3001` and restart `dev:web` — the topbar
flips to "Live" and every screen reads the real engine.

## Commands

```bash
npm run typecheck   # tsc across workspaces
npm run lint        # eslint across workspaces
npm run test        # vitest (api) — runs against an in-process Postgres (PGlite)
npm run db:generate # generate a migration from the Drizzle schema
npm run db:migrate  # apply migrations
```

## Tests

72 tests run against an in-process Postgres (PGlite) with the real migrations applied and a fake QBO
boundary, so they exercise the production schema — idempotency, the outbox, conflict detection, loop
prevention — without Docker or a remote database. Every spec edge case is covered: duplicate webhook
(UNIQUE `event_id`), out-of-order (refetch beats a stale payload), edited-in-both → conflict, delete→void
(both directions), timeout-after-write ("money shot": adopt-by-DocNumber, no duplicate), retry with
backoff → dead-letter, permanent 4xx → immediate dead-letter, payments, the reconciler (match + drift),
and a full QBO→internal round trip with the **echo dropped in both directions** (proving no loop). See
[`DESIGN.md`](DESIGN.md#testing-strategy) for the strategy and [`docs/E2E-FLOWS.md`](docs/E2E-FLOWS.md)
for the 10 reproducible end-to-end flows.

## Assumptions & tradeoffs

- **Flag-and-hold, not last-write-wins.** Auto-resolving a same-field money conflict by `updatedAt` means
  trusting two unsynchronised clocks (our server vs Intuit) and can silently drop a real financial change,
  so a same-field amount divergence holds both sides until an operator decides. Disjoint-field edits apply
  independently; identical edits converge. (Rationale in [`DESIGN.md`](DESIGN.md).)
- **DB outbox + polling worker, not a managed queue.** A `sync_events` table with a `FOR UPDATE SKIP LOCKED`
  lease gives the same exactly-once guarantees with no external infra; SQS/Inngest is the production scale
  path. The worker + reconciler are continuous poll loops, so the API must run as a **persistent service**
  (not serverless).
- **Per-link refetch in the reconciler, not CDC.** Refetching each link each pass has no cursor to get
  wrong and reuses the existing read+hash; QBO's Change-Data-Capture endpoint is the production path.
- **The "internal" system is simulated.** There's no real upstream, so `apps/api` ships a minimal
  Postgres-backed invoicing service (`/internal/*`) that emits HMAC-signed change webhooks — enough to
  demonstrate genuine two-way sync.
- **One connected sandbox realm; admin auth is opt-in.** Multi-tenant (per-realm isolation) is out of
  scope (the data model already carries `realm_id`); the admin surface has an optional `ADMIN_API_TOKEN`
  bearer guard, left unset in the demo so reviewers can drive it (see [`SECURITY.md`](SECURITY.md)).
- **Amount is the only field that round-trips both ways**, so it's the conflict surface; `customerName` /
  `balanceCents` are internal-only. **Reverse Payment sync (QBO → internal)** is deliberately deferred (a
  documented asymmetry). Deletes map to QBO **voids** (accounting keeps a zeroed record, not a hard delete).

## Production considerations

What would change for production, beyond the scope of one sandbox: auth (bearer/session) on the admin API;
the reconciler on QBO **CDC** instead of per-link refetch; the outbox on **SQS/Inngest** for multi-worker
scale; **multi-tenant** realm support with per-realm token + webhook-key management and rotation; and a
real upstream replacing the simulated internal system.

## Security

See [`SECURITY.md`](SECURITY.md) for the full threat model, the independent audit findings, and the
production-hardening roadmap. In brief:

- Secrets (the database URL, QBO keys) live only in `apps/api/.env.local`, which is gitignored;
  the repo ships empty `.env.example` placeholders.
- The internal→bridge webhook is authenticated with an HMAC-SHA256 signature compared in constant
  time (an invalid signature is a `401`). The OAuth callback validates a signed, expiring `state`
  to defend against CSRF, keyed by a value domain-separated from the client secret.
- Inbound ids are constrained at the boundary (Zod) before being used as a QBO `DocNumber` in a
  query.
- Production hardening, deliberately out of scope for one connected sandbox: per-sender webhook
  keys with a key id and rotation, and a dedicated OAuth state secret rather than one derived from
  the client secret.
- The admin/internal/demo API sits behind an **optional bearer guard** (`ADMIN_API_TOKEN`, constant-time
  compare). It's left unset in the sandbox demo so the dashboard can drive the engine; setting one env var
  locks the whole surface down. The public OAuth + webhook routes are excluded (they self-authenticate).
