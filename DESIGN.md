# LedgerBridge — design write-up

A service that keeps **invoices** (both ways), plus **payments** and **GL accounts** (internal → QBO), in sync between an internal invoicing system and QuickBooks Online (QBO), tolerant of duplicate / delayed / out-of-order events and partial failures.

## Architecture (flow)
```
Internal system  ──webhook──▶ ┌──────────────────────────────┐ ◀──webhook──  QuickBooks Online
   (API)         ◀──API write─│  1 Ingest → 2 Worker          │ ──API write─▶   (API, OAuth2)
                              │   validate·dedupe·enqueue      │
                              │   refetch→map→resolve→apply    │
                              └──────────────┬───────────────┘
                                             │ read/write
                        ┌──────────┬─────────┴──────────┬──────────────┐
                        │  links   │   sync_events       │  audit_log   │
                        └──────────┴─────────────────────┴──────────────┘
                                   ▲ backfill / match
                          Reconciler (periodic): drift + unlinked matching
```

## Two principles that drive everything
1. **A webhook is a "ping", not the source of truth.** Payloads can be incomplete / out-of-order / duplicated, so on every event we **refetch the full current state** from the source before applying. This single rule neutralizes "out-of-order" and "incomplete payload".
2. **Every write is idempotent.** Reprocessing the same event N times yields the same result — no duplicate records, no repeated writes.

## How each requirement is met
- **Idempotency:** each event carries an `event_id` → `sync_events` has a UNIQUE constraint (seen before ⇒ ACK + drop). Writes are **upsert by external id** (never blind create). Outbound writes also carry our own idempotency key.
- **Conflict resolution (edited in both):** `links` stores the **last-synced snapshot** (`{amountCents, status}`) alongside the hash/version. Before applying, both sides' current state is diffed against that snapshot. **Only one side changed** ⇒ apply it. **Both changed** ⇒ identical result is a *convergence* (reconcile, no write); a **same-field divergence** (both moved the amount, to different values) sets `status='conflict'` and **both directions hold** — neither write lands — until an operator resolves it (`resolveConflict`, exposed over the admin API). **Tradeoff — flag-and-hold, not auto-LWW:** the obvious policy is last-write-wins by `updatedAt`, but the two timestamps come from unsynchronized clocks (our app server vs Intuit), so auto-picking a winner can *silently drop a real financial change*. We never auto-resolve a same-field money conflict — a human decides. Disjoint-field edits aren't a conflict (e.g. internal `customerName` vs a QBO amount): each applies independently. The **amount is the only field that round-trips both ways**, so it is the conflict surface; `customerName`/`balanceCents` are internal-only (the mapping sends a fixed `CustomerRef`, and the QBO refetch never returns them).
- **Ordering / stale events:** because we refetch current state, an old event just re-applies the current state (harmless); use source `updatedAt`/version to **skip stale applies**.
- **Reliability under partial failure (three layers):** (1) **Durability** — every change is persisted to the `sync_events` outbox *before* any external write, so a crash loses nothing. (2) **A leased worker** — `claimNext` grabs one event with `FOR UPDATE SKIP LOCKED` (concurrent workers never double-process) and walks the status lifecycle `pending → processing → done | dead`. A transient failure schedules a retry with **exponential backoff** (base 1s, cap 5m, ≤8 attempts); a **permanent** one (`PermanentError`, thrown by the QBO client on a non-retryable 4xx) **dead-letters immediately** instead of burning the budget; a worker that crashes mid-event leaves a stale `processing` lock the next pass **reclaims** after a lease timeout. Before a create *retry* we **check-by-external-id** (DocNumber): if the prior attempt actually landed (it timed out *after* the write), we adopt it rather than duplicate — the "wrote-but-timed-out" money shot. (3) **The reconciler** is the safety net for whatever the outbox never saw (a dropped webhook): it refetches both sides and re-enqueues drift as a synthetic event into the same idempotent outbox. On `SIGTERM` the API **drains in-flight events** (stop the reconciler → finish the current event → close), so nothing is left half-applied.
- **Delete vs void:** accounting rarely hard-deletes (audit). Map internal **delete → QBO void** (and QBO void → internal delete); document the asymmetry. QBO voids keep the record (zeroed); deletes remove it. A delete/void is **terminal**, so it wins over a concurrent edit on the other side — it's evaluated before conflict detection.
- **Payments:** an internal payment syncs as a distinct entity — a QBO **`Payment`** with a `LinkedTxn` to the invoice — rather than by pushing a balance (QBO derives an invoice's Balance from its linked Payments; you can't sparse-set it). Idempotency without a `DocNumber`: a `payment` link row (check-before-create) **plus** a stable `Request-Id` so a retry after a lost response is deduped by Intuit. The payment event is emitted separately from invoice changes, and balance is always recomputed from the source — payments are never overwritten. QBO `Payment` → internal is deferred (documented asymmetry, like the reverse reconciler).
- **Accounts (chart of accounts) + GL entries:** internal GL accounts sync to QBO **`Account`** entities (one direction, internal → QBO; its own `entity_type='account'` link). A QBO `Account.Name` is unique, so this path has the *strongest* idempotency of the three: **check-before-create by Name** (a create that landed but whose link write was lost is adopted, not duplicated — the account analogue of the invoice DocNumber adopt), an unchanged re-delivery is hashed and skipped, and a stable `Request-Id` (`account:<id>:<version>`) adds Intuit's API-level dedup. **Why not push raw GL `JournalEntry` rows?** QBO *auto-generates* the GL journal entries from invoice and payment postings, so the meaningful, non-duplicating thing to sync is the **chart of accounts** those postings reference; posting JournalEntries ourselves would double-count. Reverse (QBO → internal) account sync is deferred, like reverse Payment.
- **Loop prevention (important):** our own write to QBO triggers a QBO webhook back. Detect the echo by comparing the incoming hash to `last_synced_hash`; if equal, it's our echo → skip. Prevents infinite bounce.
- **Reconciliation (exists both sides, no link) + drift recovery:** a periodic `Reconciler` does two jobs. (1) **Match** unlinked invoices by DocNumber (= the internal id we write to QBO) + amount; an ambiguous (>1) match or an amount mismatch is **flagged** (`status='conflict'`, resolvable by the M6 operator path), never blindly linked. (2) **Drift recovery** for dropped webhooks: it refetches both sides and, when a QBO `SyncToken` or an internal hash has moved past `last_synced_*`, **enqueues a synthetic event** (`reconcile:*` namespace) into the same idempotent outbox — the worker then re-converges it. It skips any entity with an in-flight `sync_events` row (no thrash) and writes one heartbeat audit per pass (the data behind "last-reconcile"). **Tradeoff — per-link refetch vs CDC:** we refetch each link each pass (no cursor to get wrong, reuses the existing read + hash); QBO's CDC endpoint (one call returns all changed invoices) is the production scale path. **Limitation:** a QBO invoice created independently with a different DocNumber scheme won't match (out of scope — QBO-only).
- **Auditability:** `audit_log` row per action — event, action, before/after, result, error.

## Data model (core tables)
- **`links`** — `id`, `entity_type` (invoice | payment | account), `internal_id`, `qbo_id`, `last_synced_hash`, `last_internal_version`, `last_qbo_version`, `last_synced_snapshot` (`{amountCents, status}` — the basis the next event's conflict check diffs against), `status` (linked | conflict | error | skip), timestamps. The mapping + the basis for conflict detection.
- **`sync_events`** — `event_id` (UNIQUE = idempotency), `source` (internal | qbo), `entity_type`, `entity_external_id`, `status` (pending | processing | done | failed | dead), `attempts`, `payload` (raw), `received_at`, `processed_at`. The inbox/outbox.
- **`audit_log`** — `id`, `event_id`, `entity_type`, `action` (create | update | void | skip | conflict | conflict_resolved), `before`, `after`, `result` (ok | error), `error`, `ts`.
- **`oauth_tokens`** — QBO `realm_id`, `access_token`, `refresh_token`, `expires_at` (refresh before expiry).

## Deliberate tradeoffs (why not X?)
Beyond the two argued inline — **flag-and-hold vs auto-LWW** (unsynchronised clocks can drop a real change) and **per-link refetch vs CDC** (no cursor to get wrong) — the load-bearing choices:
- **DB outbox + polling worker, not SQS/Inngest.** A `sync_events` table + a `FOR UPDATE SKIP LOCKED` lease give exactly-once processing with zero external infra and the same correctness; a managed queue is the scale path. Cost: the worker/reconciler are poll loops, so the API runs as a **persistent service**, not serverless. **Latency** is cut with **Postgres `LISTEN/NOTIFY`**: an `AFTER INSERT` trigger on `sync_events` fires `pg_notify`, and a dedicated listener wakes the worker so a fresh event is picked up sub-second instead of waiting out the poll interval. The wake is purely a latency optimization layered *on top of* polling — if the listen connection can't be established (it needs Neon's **unpooled** host, since PgBouncer drops `LISTEN`) the worker keeps draining the outbox by polling, so correctness never depends on it.
- **A lease, not a multi-worker queue.** One leased worker is equivalent to a single-consumer partition and suffices here; `SKIP LOCKED` already makes adding workers safe, but visibility-timeout/coordination tuning is deferred with the queue.
- **Two-layer idempotency.** Inbound dedup is a UNIQUE `event_id` (one table, no idempotency-token store); outbound writes additionally carry a stable `Request-Id` so Intuit dedupes a create retried after a lost response (Payments have no `DocNumber`, so it's their only key).
- **Permanent vs transient.** The QBO client throws `PermanentError` on a 4xx that can't succeed on retry (400/422) → dead-letter immediately; 401/403/429/5xx/network stay transient (auth refreshes, rate-limit/server errors recover).
- **Reverse Payment sync deferred; deletes → voids.** A QBO-entered Payment flowing back adds parsing + matching for little demo value (documented asymmetry). Internal deletes map to QBO **voids** (a zeroed, audit-preserving record); a delete/void is terminal, so it wins over a concurrent edit and is checked before conflict detection.
- **Observability: correlation IDs everywhere, OpenTelemetry opt-in.** Every event, audit row, and log line carries a `correlation_id` (the originating event id / `reconcile:*` / `resolve:*`), so a single change is traceable end-to-end; the `audit_log` is the durable record (before/after/result/error). **Distributed tracing** is wired as **manual OpenTelemetry spans** on the sync pipeline (`sync.process_event` → nested `qbo.request`) plus a per-request HTTP span, off by default and enabled with `OTEL_ENABLED` (`ConsoleSpanExporter`, or OTLP/HTTP to a collector when `OTEL_EXPORTER_OTLP_ENDPOINT` is set). Manual spans over auto-instrumentation because the latter needs ESM loader hooks under `tsx`; the spans that matter are the business operations anyway, and they cost nothing (the API no-op tracer) until enabled.

## Edge-case handling (map to the spec list)
| Edge case | How |
|---|---|
| duplicate webhook | `event_id` unique → drop |
| out-of-order | refetch current state + version check |
| edited in both | diff both vs the last-synced snapshot: same-field (amount) divergence → `status='conflict'`, held for an operator; disjoint-field edits apply independently; identical edits converge |
| delete vs void | delete → void in QBO; document |
| partially paid invoice edited | sync payments as a QBO `Payment` with a `LinkedTxn` to the invoice (its own milestone); recompute balance from the source of truth, don't overwrite payments blindly |
| timeout after write | check-by-external-id before retry → idempotent |
| retry after partial success | outbox status + attempts; idempotent re-apply |
| exists both, no link | reconciler matches (number+amount+date) → create link / flag |

## Testing strategy
**82 tests** (Vitest) run against an **in-process Postgres (PGlite)** with the real migrations applied and a **fake QBO boundary** (`createFakeQbo` records what the processor asked it to do), so they exercise the production schema + the real worker/reconciler logic with no Docker or network. What they prove:
- **Idempotency** — a re-delivered webhook is dropped (UNIQUE `event_id`); an unchanged re-apply is short-circuited (no QBO call).
- **The money shot** — an invoice already in QBO with no link (the prior write timed out *after* landing) is **adopted and updated, never duplicated**.
- **Conflict** — both sides editing the amount flags `conflict` and holds both directions; disjoint edits don't; identical edits converge; both resolve directions apply the winner.
- **Loop prevention** — a QBO edit applies to internal and the echo it triggers is dropped (full round trip); a re-delivered/out-of-order QBO webhook for an already-applied change is dropped.
- **Failure** — a transient error retries with backoff then dead-letters at max attempts; a `PermanentError` dead-letters on the first attempt; a stale lock is reclaimed after a crash.
- **Account sync** — an internal GL account creates one QBO `Account`; a re-delivery is skipped; a pre-existing account (same Name, no link) is **adopted, not duplicated**; a rename syncs as an update.
- **Reverse, payments, reconciler, OAuth, the admin API** each have their own suite; admin responses are parsed against the shared zod contract.

Live verification (the dashboard **Demo** panel against the real sandbox) covers the third integration point — actual QBO webhook delivery — which the deterministic suite mocks at the boundary.

## Out of scope (by design)
- **Auth on the admin/dashboard API** — unauthenticated for one sandbox demo; the route layer is the single place to add a bearer token / session.
- **Multi-tenant** beyond one connected realm (the model already carries `realm_id`).
- **Reverse account & Payment sync** (QBO → internal) and **raw GL `JournalEntry` posting** — QBO derives GL journal entries from invoice/payment postings, so the chart of accounts is what we sync; the reverse direction for payments/accounts adds parsing + matching for little demo value (documented asymmetry).
- **Broader QBO entity coverage** (Vendors, Bills, Estimates, …) beyond invoices / payments / accounts.

## Decisions made
1. **Fastify** for the webhook receivers + OAuth callback (small, fast, first-class async).
2. **A simulated internal system** (`/internal/*`, Postgres-backed, emits HMAC-signed change webhooks) — there's no real upstream, and this is what makes a genuine two-way demo possible.
3. **A DB-backed outbox + a leased polling worker** for the queue (SQS/Inngest is the production scale path).
