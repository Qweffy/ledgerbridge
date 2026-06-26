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

Verified end-to-end against a real QBO sandbox (an internal invoice propagates to a QBO invoice;
re-delivered webhooks are dropped). The reverse direction's logic — including the no-loop round trip —
is proven deterministically (in-process Postgres + a mocked QBO boundary); live webhook delivery needs
an ngrok tunnel to the sandbox. Conflict resolution, reconciliation, the observability API and the web
dashboard are next.

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
  api/    # Fastify: internal system, OAuth, ingest, sync worker. Drizzle + db/.
  web/    # Next.js: design system + (coming) dashboard & landing.
packages/
  shared/ # canonical enums, types, status vocabulary.
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
| `INTERNAL_WEBHOOK_TARGET` | Where the internal system posts change webhooks (the bridge ingest). |
| `PORT` | API port (default `3001`). |

> The sync worker only starts when `QBO_REALM_ID`, `QBO_DEFAULT_CUSTOMER` and `QBO_DEFAULT_ITEM` are
> set (otherwise the API runs without it and logs a warning).

Apply the migrations, then run:

```bash
npm run db:migrate -w @ledgerbridge/api   # create the schema
npm run dev:api                            # Fastify on :3001 (ingest + sync worker)
npm run dev:web                            # Next.js on :3000  (/design gallery)
```

Connect a QBO sandbox by opening <http://localhost:3001/oauth/connect> and authorising the app.

## Commands

```bash
npm run typecheck   # tsc across workspaces
npm run lint        # eslint across workspaces
npm run test        # vitest (api) — runs against an in-process Postgres (PGlite)
npm run db:generate # generate a migration from the Drizzle schema
npm run db:migrate  # apply migrations
```

## Tests

The API suite runs against an in-process Postgres (PGlite) with the real migrations applied, so it
exercises the production schema — including the idempotency and outbox logic — without Docker or a
remote database. The most important edge cases are covered: duplicate webhook, timeout-after-write
("money shot"), retry/dead-letter, delete→void, and the reverse direction — a QBO edit applied to the
internal system with the **echo dropped in both directions** (a full round trip that proves no loop).

## Security

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
