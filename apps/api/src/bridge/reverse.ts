import type { InternalInvoice } from "../internal/service";
import type { SyncEventRow } from "./processor";
import type { Database } from "../../db/types";
import { writeAudit } from "./audit";
import { actionFor, analyze, canonicalFromInternal, canonicalFromQbo } from "./conflict";
import { getLinkByQboId, markLinkConflict, upsertLink } from "./links";
import { hashInvoice } from "./mapping";
import type { QboInvoiceOps } from "./qbo-ops";

// How the reverse direction writes back into the internal system. Injected so the
// processor stays testable; production wires these to the internal service (which
// emits the internal change webhook — the echo is dropped on the way back by hash).
export interface InternalApply {
  updateAmount(id: string, amountCents: number): Promise<InternalInvoice>;
  remove(id: string): Promise<InternalInvoice>;
}

export interface ReverseDeps {
  qbo: Pick<QboInvoiceOps, "read">;
  internal: InternalApply;
  // Refetch the current internal invoice for conflict detection (never trust state).
  refetchInternal: (id: string) => Promise<InternalInvoice | undefined>;
}

// Apply one QBO-sourced invoice change to the internal system. Gate order mirrors the
// forward direction: echo skip and the terminal void run before conflict detection.
export async function processQboToInternal(
  db: Database,
  event: SyncEventRow,
  deps: ReverseDeps,
  now: Date,
): Promise<void> {
  const qboId = event.entityExternalId;
  const correlationId = event.correlationId ?? undefined;

  // Refetch — never trust the webhook payload; read the current QBO state.
  const state = await deps.qbo.read(qboId);

  const link = await getLinkByQboId(db, "invoice", qboId);
  if (!link?.internalId) {
    // A QBO invoice with no link of ours: created directly in QBO, or a link we
    // lost. Matching it is the reconciler's job (M7) — record and move on.
    await writeAudit(
      db,
      { eventId: event.eventId, entityType: "invoice", entityExternalId: qboId, action: "skip", result: "ok", error: "no link for QBO invoice (reconcile)", correlationId },
      now,
    );
    return;
  }
  const internalId = link.internalId;
  const base = { eventId: event.eventId, entityType: "invoice" as const, entityExternalId: internalId, correlationId };

  // Echo / loop prevention: a change at or below the version we last wrote back is
  // our own write-back (or a stale, out-of-order delivery). Drop it.
  const seenVersion = link.lastQboVersion ?? -1;
  const incomingVersion = Number(state.SyncToken);
  if (incomingVersion <= seenVersion) {
    await writeAudit(db, { ...base, action: "skip", result: "ok", error: "echo: own write-back or stale QBO version" }, now);
    return;
  }

  // Terminal: voided in QBO → deleted internally (mirror of internal delete → QBO
  // void). Delete wins over a concurrent edit, so it precedes conflict detection.
  if (state.voided) {
    const applied = await deps.internal.remove(internalId);
    await upsertLink(db, { entityType: "invoice", internalId, qboId, lastSyncedHash: hashInvoice(applied), lastInternalVersion: applied.version, lastQboVersion: incomingVersion, lastSyncedSnapshot: canonicalFromInternal(applied), status: "linked" }, now);
    await writeAudit(db, { ...base, action: "void", before: { qboId, version: seenVersion }, after: { qboId, voided: true }, result: "ok" }, now);
    return;
  }

  const internal = await deps.refetchInternal(internalId);
  if (!internal) {
    await writeAudit(db, { ...base, action: "skip", result: "ok", error: "internal invoice not found" }, now);
    return;
  }

  const snapshot = link.lastSyncedSnapshot ?? null;
  const analysis = analyze(snapshot, canonicalFromInternal(internal), canonicalFromQbo(state));

  // Held conflict: only convergence clears it automatically; else hold.
  if (link.status === "conflict") {
    if (analysis.outcome === "converged" || analysis.outcome === "neither") {
      await upsertLink(db, { entityType: "invoice", internalId, qboId, lastSyncedHash: hashInvoice(internal), lastInternalVersion: internal.version, lastQboVersion: incomingVersion, lastSyncedSnapshot: canonicalFromInternal(internal), status: "linked" }, now);
      await writeAudit(db, { ...base, action: "skip", result: "ok", error: "conflict cleared (sides converged)" }, now);
    } else {
      await writeAudit(db, { ...base, action: "skip", result: "ok", error: "held: link in conflict; awaiting resolution" }, now);
    }
    return;
  }

  const action = actionFor("quickbooks", analysis);
  if (action === "conflict") {
    await markLinkConflict(db, link.id, now);
    await writeAudit(db, { ...base, action: "conflict", before: { amountCents: snapshot?.amountCents }, after: { internalAmountCents: internal.amountCents, qboAmountCents: state.totalCents }, result: "ok" }, now);
    return;
  }
  if (action === "skip") {
    // QBO drifted on a non-synced field, or only internal changed — don't apply to
    // internal. Acknowledge the QBO version so we don't reprocess; keep the snapshot.
    await upsertLink(db, { entityType: "invoice", internalId, qboId, lastSyncedHash: hashInvoice(internal), lastInternalVersion: internal.version, lastQboVersion: incomingVersion, status: "linked" }, now);
    await writeAudit(db, { ...base, action: "skip", result: "ok", error: "no syncable field changed" }, now);
    return;
  }
  if (action === "converged") {
    await upsertLink(db, { entityType: "invoice", internalId, qboId, lastSyncedHash: hashInvoice(internal), lastInternalVersion: internal.version, lastQboVersion: incomingVersion, lastSyncedSnapshot: canonicalFromInternal(internal), status: "linked" }, now);
    await writeAudit(db, { ...base, action: "skip", result: "ok", error: "converged (both sides match)" }, now);
    return;
  }

  // action === "apply" → pull QBO's amount into the internal invoice.
  const applied = await deps.internal.updateAmount(internalId, state.totalCents);
  await upsertLink(db, { entityType: "invoice", internalId, qboId, lastSyncedHash: hashInvoice(applied), lastInternalVersion: applied.version, lastQboVersion: incomingVersion, lastSyncedSnapshot: canonicalFromInternal(applied), status: "linked" }, now);
  await writeAudit(db, { ...base, action: "update", before: { qboId, version: seenVersion }, after: { qboId, version: incomingVersion, totalCents: state.totalCents, hash: hashInvoice(applied) }, result: "ok" }, now);
}
