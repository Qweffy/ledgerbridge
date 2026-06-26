# LedgerBridge — design write-up (draft)

A service that keeps invoices (and payments, GL accounts) in sync **both ways** between an internal invoicing system and QuickBooks Online (QBO), tolerant of duplicate / delayed / out-of-order events and partial failures.

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
- **Failure / partial ("wrote but timed out"):** outbox + **retries with exponential backoff**. Before retrying a create, **query the target by external id / idempotency key** to see if it already landed → no duplicate. Permanent failures → **dead-letter + flag**.
- **Delete vs void:** accounting rarely hard-deletes (audit). Map internal **delete → QBO void** (and QBO void → internal delete); document the asymmetry. QBO voids keep the record (zeroed); deletes remove it. A delete/void is **terminal**, so it wins over a concurrent edit on the other side — it's evaluated before conflict detection.
- **Loop prevention (important):** our own write to QBO triggers a QBO webhook back. Detect the echo by comparing the incoming hash to `last_synced_hash`; if equal, it's our echo → skip. Prevents infinite bounce.
- **Reconciliation (exists both sides, no link):** the `Reconciler` matches by invoice number + amount + date, creates the link; ambiguous matches → flag.
- **Auditability:** `audit_log` row per action — event, action, before/after, result, error.

## Data model (core tables)
- **`links`** — `id`, `entity_type` (invoice | payment | account), `internal_id`, `qbo_id`, `last_synced_hash`, `last_internal_version`, `last_qbo_version`, `last_synced_snapshot` (`{amountCents, status}` — the basis the next event's conflict check diffs against), `status` (linked | conflict | error | skip), timestamps. The mapping + the basis for conflict detection.
- **`sync_events`** — `event_id` (UNIQUE = idempotency), `source` (internal | qbo), `entity_type`, `entity_external_id`, `status` (pending | processing | done | failed | dead), `attempts`, `payload` (raw), `received_at`, `processed_at`. The inbox/outbox.
- **`audit_log`** — `id`, `event_id`, `entity_type`, `action` (create | update | void | skip | conflict | conflict_resolved), `before`, `after`, `result` (ok | error), `error`, `ts`.
- **`oauth_tokens`** — QBO `realm_id`, `access_token`, `refresh_token`, `expires_at` (refresh before expiry).

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

## What's deliberately out of scope (note in README)
- A real UI (this is a service; a tiny status/audit endpoint is enough).
- Full QBO entity coverage beyond invoices/payments/accounts.
- Multi-tenant beyond one connected realm (the model supports it via `realm_id`).

## Open decisions for the build session
1. **HTTP framework** for webhook receivers + OAuth callback (recommend Fastify; Hono/Express also fine).
2. **The "internal" system:** simulate a minimal one (a tiny Postgres-backed API + a way to emit changes) so you can demo true two-way sync.
3. **Queue:** a DB-backed outbox table + a polling worker is enough; mention Inngest/SQS as the production path in the write-up.
