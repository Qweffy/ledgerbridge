# End-to-end flows

Ten flows that exercise the whole engine. Each is **reproducible** — most from the dashboard's **Demo**
panel (`/demo`, or the top-bar **Demo** button), the rest from the QBO sandbox UI or the `/internal/*` API.
Every flow names the deterministic test that proves the same behaviour offline (`apps/api/tests/unit/`), so
nothing here depends on a live sandbox to be trusted.

Where to look:
- **Dashboard** — Overview (counts/feed), Invoices (links + field diff), Conflicts, Events (status + replay),
  Audit (before→after time-travel).
- **QBO sandbox** — the Intuit sandbox company's Invoices/Payments lists.
- **SQL** — Neon: `select * from sync_events|links|audit_log order by id desc`.

---

### Flow 1 — OAuth connect
**Proves** the QBO connection: authorization-code exchange + token storage + auto-refresh.
**Do** open `‹API›/oauth/connect` → authorise the sandbox company.
**Watch** `oauth_tokens` gets a row for the realm; the dashboard top-bar shows **Live**; the API log prints
`sync worker + reconciler started`.
**Expect** the engine is armed; access tokens refresh ~hourly off the refresh token with no re-consent.
*(Test: `oauth.test.ts` — authorize URL, code exchange, refresh-within-skew, callback state/CSRF.)*

### Flow 2 — Internal → QBO create, idempotent on re-delivery
**Proves** the forward sync core + idempotency.
**Do** Demo → **Create invoice** (twice quickly, or replay the webhook).
**Watch** Events: the event goes `pending → processing → done`; Invoices: a new **linked** row with a real
QBO id; QBO sandbox: exactly **one** invoice with that DocNumber.
**Expect** one QBO invoice no matter how many deliveries — the second is dropped by the UNIQUE `event_id`,
and an unchanged re-apply is short-circuited (no QBO call).
*(Tests: `bridge.test.ts` — "create … re-delivery is idempotent", "duplicate webhook … one outbox row".)*

### Flow 3 — QBO → internal, echo dropped (no loop)
**Proves** reverse sync + two-way loop prevention.
**Do** edit an invoice's amount **in the QBO sandbox UI** (or wait for its CDC webhook).
**Watch** Audit: an `update` applied to the internal invoice (refetched, not trusted from the payload); then
**no** write back to QBO (the internal echo is recognised by its state hash and the QBO echo by its
`SyncToken`).
**Expect** the change lands once; the directions don't ping-pong.
*(Test: `reverse.test.ts` — "an edit made in QBO propagates … echo it triggers is dropped (flow #3)".)*

### Flow 4 — Same field edited in both → conflict → resolve
**Proves** conflict detection (flag-and-hold) + the operator resolve action.
**Do** Demo → **Edit in both** (bumps the internal amount and the QBO amount to two different values).
**Watch** Conflicts: a new row (`Amount mismatch`, the sidebar badge ticks up). Open it → the before/after
diff → pick a winner → **Resolve**. The conflict clears; Audit shows `conflict_resolved`.
**Expect** while conflicted, **neither** side is clobbered; resolution writes the chosen value to the other
system and reopens the link.
*(Tests: `conflict.test.ts` — "flow #4 … neither side clobbered", both resolve directions; `demo.test.ts` —
"edit-both … flips to conflict".)*

### Flow 5 — Different fields edited in both → no false conflict
**Proves** that disjoint-field edits aren't a conflict.
**Do** edit a **non-synced** field internally (e.g. `customerName`) while QBO's amount changed.
**Watch** Audit: a `skip` ("no syncable field changed") — **not** a conflict; the link stays `linked`.
**Expect** only the amount round-trips, so editing other fields never opens a spurious conflict.
*(Test: `conflict.test.ts` — "flow #5 … no false conflict".)*

### Flow 6 — Partial payment → balance syncs, payments not clobbered
**Proves** payment sync as a first-class QBO `Payment` with a `LinkedTxn`.
**Do** `POST /internal/payments` for a partial amount against a synced invoice (or pay it in the internal
API).
**Watch** QBO sandbox: a new **Payment** linked to the invoice; the invoice **Balance** drops by that amount;
Audit records it. Re-deliver → no duplicate payment.
**Expect** balance is recomputed from the source, never sparse-set; idempotent via a `payment` link row + a
stable `Request-Id`.
*(Test: `payments.test.ts` — partial payment, idempotent re-delivery, paid-in-full, out-of-order.)*

### Flow 7 — Internal delete → QBO void
**Proves** the delete-vs-void asymmetry; a terminal action wins.
**Do** `DELETE /internal/invoices/:id` on a synced invoice.
**Watch** QBO sandbox: the invoice is **voided** (zeroed, still present — not hard-deleted); Audit shows
`void`. The internal echo doesn't re-void it.
**Expect** accounting keeps an audit trail; a delete/void beats a concurrent edit (checked before conflict
detection).
*(Test: `bridge.test.ts` — "internal delete → voids the linked QBO invoice"; `reverse.test.ts` — QBO void →
internal delete, no re-void.)*

### Flow 8 — Timeout after write → retry → no duplicate (the money shot)
**Proves** the wrote-but-timed-out case: the external write landed but the link write was lost.
**Do** Demo → **Inject fault** (arms a one-shot fault + emits a victim invoice). *(Or, deterministically: a
QBO invoice already exists with the internal DocNumber but no link row.)*
**Watch** Events: the victim retries with `injected fault (demo)` and **dead-letters** at 8/8. On the
adopt-path variant, the worker finds the existing QBO invoice by DocNumber and **updates** it.
**Expect** check-by-external-id before any create → the prior write is adopted, never duplicated.
*(Tests: `bridge.test.ts` — "timeout-after-write … adopted and updated, not duplicated (money shot)";
`demo.test.ts` — "inject-fault … dead-letters".)*

### Flow 9 — Pre-existing in both, no link → reconciler matches / flags
**Proves** backfill: reconcile entities that exist on both sides with no prior linkage.
**Do** ensure an internal invoice and a QBO invoice share a DocNumber + amount but no link → Demo →
**Run reconciler**.
**Watch** Invoices: the pair becomes **linked**. An ambiguous (>1 QBO match) or amount-mismatch pair is
**flagged** as a conflict instead of blindly linked.
**Expect** safe matching (number + amount), never a blind link.
*(Test: `reconcile.test.ts` — "flow #9 … matches by DocNumber + amount", ambiguous + mismatch flagged.)*

### Flow 10 — Dropped webhook → reconciler catches the drift
**Proves** the reconciler as the safety net for lost events.
**Do** change a QBO invoice **without** delivering its webhook (simulate a drop) → Demo → **Run reconciler**.
**Watch** the reconciler refetches both sides, sees the QBO `SyncToken`/hash moved past `last_synced_*`, and
**enqueues a synthetic `reconcile:*` event**; the worker re-converges the state. Drift indicators settle on
Invoices.
**Expect** no change is permanently lost even if its webhook never arrives; a second pass over the same
drift enqueues nothing new (idempotent).
*(Tests: `reconcile.test.ts` — "flow #10 … catches QBO drift … synthetic event", "second pass … nothing
new".)*
