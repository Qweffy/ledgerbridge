# Trying LedgerBridge

A hands-on guide to run LedgerBridge locally and drive every flow yourself.

## What it is

Two-way invoice sync between a **simulated internal invoicing system** and **QuickBooks Online (QBO)**. A change
on either side propagates to the other — **exactly once, in order, conflict-aware, and resilient to partial
failures**. The repo ships the backend (a Fastify API + a durable-outbox sync worker + a reconciler), the
simulated internal system it syncs from, and an operator dashboard to watch and drive it.

The two ideas the whole thing rests on: **a webhook is a ping, not the truth** (every event triggers a refetch
of the current state before anything is applied), and **every write is idempotent** (reprocessing the same
event changes nothing).

## Run it locally

Requirements: Node 22+, a Postgres database (a free [Neon](https://neon.tech) project), and an
[Intuit Developer](https://developer.intuit.com) app with a QBO **sandbox** company.

```bash
npm install
cp apps/api/.env.example apps/api/.env.local      # fill in DATABASE_URL, QBO_*, INTERNAL_WEBHOOK_*
npm run db:migrate -w @ledgerbridge/api           # create the schema
npm run dev:api                                    # :3001 — API + sync worker + reconciler
npm run dev:web                                    # :3000 — dashboard + landing
```

Connect a QBO sandbox: open <http://localhost:3001/oauth/connect> and authorise the app.

By default the dashboard runs on **mock fixtures** (the topbar shows "Mock data") — explorable with no backend.
To drive the **real** engine, create `apps/web/.env.local` with `NEXT_PUBLIC_API_URL=http://localhost:3001` and
restart `dev:web`; the topbar flips to **"Live"** and every screen reads the real engine.

Then open <http://localhost:3000>.

## What each screen is

- **Landing (`/`)** — the public page: what the product is, an animated "watch an invoice cross the bridge",
  and the architecture + reliability story.
- **Overview (`/dashboard`)** — the operator home: health, live counts (queued · in-flight · synced ·
  dead-letter · conflicts), the oldest-pending lag, last-reconcile, and a live event feed.
- **Invoices (`/invoices`)** — every linked entity (internal ↔ QBO). Open one for a **field-level diff** of the
  internal record vs its QBO counterpart + its audit trail. Filters, and an **Export** to CSV.
- **Conflicts (`/conflicts`)** — the queue of same-field divergences held for a human. Open one to see the
  before/after diff and **resolve** it by picking the winning side.
- **Events (`/events`)** — every event flowing through the outbox: status, retry attempts, and a **dead-letter**
  section with **Replay**. Open one for the raw payload + the audit trail.
- **Audit (`/audit`)** — the append-only record of every action (create / update / void / conflict / resolve /
  skip), with **before→after** time-travel.
- **Demo (`/demo`)** — the control panel that drives the live engine (the four buttons used below). Also reachable
  from the **Demo** button in the topbar.
- **⌘K** (or click the search box) — a command palette to jump between screens.

## Drive each flow

Most flows run from the **Demo** panel; the two without a button are a `curl` away. Watch the effect ripple
through the screens listed under each.

### 1. Create invoice — forward sync + idempotency
Emits an invoice in the internal system; the worker syncs it to QBO **exactly once**.
**Do:** Demo → **Create invoice**.
**See:** *Events* — `pending → processing → done`; *Invoices* — a new **linked** row with a real QBO id;
*Overview* — Synced ticks up. In the QBO sandbox: exactly one invoice with that DocNumber.

### 2. Edit in both — conflict → resolve
Edits the same invoice on both sides to different amounts → detects the both-changed conflict and **holds both
sides** (no clobber) until you decide.
**Do:** Demo → **Edit in both**, then sidebar *Conflicts* → open it → pick a winner → **Resolve**.
**See:** the conflict queued ("Amount mismatch"); on resolve, the chosen value is written to the other side and
the conflict clears; *Audit* shows `conflict` then `conflict_resolved`.

### 3. Inject fault — retry → dead-letter → replay
Forces the next QBO writes to fail → the event retries with backoff and **dead-letters**; you replay it.
**Do:** Demo → **Inject fault**, then *Events* → the victim dead-letters → **Replay**.
**See:** the red dead-letter banner + the error; after Replay → requeued (`pending`).

### 4. Run reconciler — the safety net
Catches changes the outbox never saw (a missed webhook) and matches entities that exist on both sides with no
link.
**Do:** Demo → **Run reconciler**.
**See:** the result log summary `{links, matched, flagged, scanned, driftEnqueued}`; drift indicators settle on
*Invoices*.

### 5. Edit in QuickBooks — reverse sync + loop prevention
A change made **in QBO** propagates to the internal system, and the echo it triggers does **not** loop back.
**Do:** edit an invoice's amount in the **QBO sandbox UI** → it propagates automatically (if the QBO webhook is
configured) or instantly via Demo → **Run reconciler**.
**See:** *Audit* — an `update` applied to the internal invoice (refetched from QBO, not trusted from a payload),
and **no** write-back to QBO; *Invoices* detail shows the new amount.

### 6. Partial payment → balance syncs *(API)*
A partial payment syncs as a QBO `Payment` with a `LinkedTxn`; the invoice Balance drops, payments aren't
clobbered. Take an `INV-…` id from *Invoices*, then:
```bash
curl -X POST http://localhost:3001/internal/invoices/INV-XXXX/payments \
  -H "content-type: application/json" -d '{"amountCents":10000}'
```
**See:** *Invoices* — balance drops; *Audit* — `create · payment`. Re-deliver → no duplicate.

### 7. Internal delete → QBO void *(API)*
A delete maps to a QBO **void** (a zeroed, retained record — not a hard delete).
```bash
curl -X DELETE http://localhost:3001/internal/invoices/INV-XXXX
```
**See:** *Audit* — `void`; in the QBO sandbox the invoice is **Voided**.

---

Every flow above also has a deterministic test behind it — see [`docs/E2E-FLOWS.md`](E2E-FLOWS.md) for the
10 flows mapped to their backing test, and [`DESIGN.md`](../DESIGN.md) for why each piece works the way it does.
