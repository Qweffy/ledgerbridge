import { syncEvents } from "../../db/schema";
import type { Database } from "../../db/types";
import type { InternalInvoice } from "../internal/service";
import { writeAudit } from "./audit";
import { actionFor, analyze, canonicalFromInternal, canonicalFromQbo } from "./conflict";
import { getLinkByInternalId, markLinkConflict, upsertLink } from "./links";
import { hashInvoice, mapInvoiceToQbo, type QboInvoiceDefaults } from "./mapping";
import type { QboInvoiceOps, QboInvoiceState } from "./qbo-ops";
import { processQboToInternal, type InternalApply } from "./reverse";
import { processPaymentToQbo, type PaymentProcessorDeps } from "./payments";
import { processAccountToQbo, type AccountProcessorDeps } from "./accounts";

export type SyncEventRow = typeof syncEvents.$inferSelect;

export interface ProcessorDeps {
  // Refetch the current internal invoice (never trust the webhook payload).
  refetchInternalInvoice: (id: string) => Promise<InternalInvoice | undefined>;
  qbo: QboInvoiceOps;
  defaults: QboInvoiceDefaults;
  // The reverse direction (QBO → internal). Optional: when unset, QBO-sourced
  // events are not applied (one-direction deployments).
  applyToInternal?: InternalApply;
  // Payment sync (internal payment → QBO Payment). Optional.
  payments?: PaymentProcessorDeps;
  // Account sync (internal GL account → QBO Account). Optional.
  accounts?: AccountProcessorDeps;
  // Demo/test seam: when armed, throws before an outbound QBO write so a fault can
  // be exercised through to retry → dead-letter. Inert (undefined) in normal runs.
  faultInjector?: () => void;
  now?: () => Date;
}

// Route an event by entity type and source. Each path is idempotent and audited;
// loop prevention is split across the directions (version on the QBO side, hash on
// the internal side), and conflict detection is shared (conflict.ts).
export async function processEvent(
  db: Database,
  event: SyncEventRow,
  deps: ProcessorDeps,
): Promise<void> {
  const now = deps.now?.() ?? new Date();

  if (event.entityType === "invoice") {
    if (event.source === "internal") {
      return processInternalToQbo(db, event, deps, now);
    }
    if (event.source === "quickbooks") {
      if (!deps.applyToInternal) return;
      return processQboToInternal(
        db,
        event,
        { qbo: deps.qbo, internal: deps.applyToInternal, refetchInternal: deps.refetchInternalInvoice },
        now,
      );
    }
    return;
  }

  if (event.entityType === "payment") {
    // Only internal → QBO payments for now; QBO Payment → internal is deferred.
    if (event.source === "internal" && deps.payments) {
      return processPaymentToQbo(db, event, deps.payments, now);
    }
    return;
  }

  if (event.entityType === "account") {
    // Only internal → QBO accounts; QBO Account → internal is deferred (documented).
    if (event.source === "internal" && deps.accounts) {
      return processAccountToQbo(db, event, deps.accounts, now);
    }
  }
}

// Apply one internal-invoice event to QBO, idempotently. Gate order matters: echo
// skip and the terminal delete→void run before conflict detection so our own echo
// never false-positives as a conflict and a delete always wins.
async function processInternalToQbo(
  db: Database,
  event: SyncEventRow,
  deps: ProcessorDeps,
  now: Date,
): Promise<void> {
  const internalId = event.entityExternalId;
  const correlationId = event.correlationId ?? undefined;
  const base = { eventId: event.eventId, entityType: "invoice" as const, entityExternalId: internalId, correlationId };

  const invoice = await deps.refetchInternalInvoice(internalId);
  if (!invoice) {
    await writeAudit(db, { ...base, action: "skip", result: "ok", error: "internal invoice not found" }, now);
    return;
  }

  const link = await getLinkByInternalId(db, "invoice", internalId);
  const hash = hashInvoice(invoice);

  // Echo / re-delivery on a healthy link: unchanged since our last sync. Cheapest
  // gate, and it runs before any QBO read so echoes cost nothing.
  if (link && link.status === "linked" && link.lastSyncedHash === hash) {
    await writeAudit(db, { ...base, action: "skip", result: "ok", error: "unchanged since last sync" }, now);
    return;
  }

  // Terminal: internal delete → QBO void. Delete wins over a concurrent edit (it's
  // terminal and safe), so it precedes conflict detection and clears any hold.
  if (invoice.status === "deleted") {
    if (link?.qboId) {
      const ref = await deps.qbo.read(link.qboId);
      const voided = await deps.qbo.voidInvoice(ref.Id, ref.SyncToken);
      await upsertLink(db, { entityType: "invoice", internalId, qboId: link.qboId, lastSyncedHash: hash, lastInternalVersion: invoice.version, lastQboVersion: Number(voided.SyncToken), lastSyncedSnapshot: canonicalFromInternal(invoice), status: "linked" }, now);
      await writeAudit(db, { ...base, action: "void", before: { qboId: link.qboId }, after: { qboId: link.qboId, voided: true }, result: "ok" }, now);
    } else {
      await writeAudit(db, { ...base, action: "skip", result: "ok", error: "no linked QBO invoice to void" }, now);
    }
    return;
  }

  // A real internal change with a mapping: refetch QBO and decide against the snapshot
  // taken at the last sync — clean apply, both-changed conflict, no-op for QBO, or a
  // convergence.
  const qboState: QboInvoiceState | undefined = link?.qboId ? await deps.qbo.read(link.qboId) : undefined;
  if (link && qboState) {
    const snapshot = link.lastSyncedSnapshot ?? null;
    const analysis = analyze(snapshot, canonicalFromInternal(invoice), canonicalFromQbo(qboState));

    // Held conflict: only a convergence (both sides now agree) clears it
    // automatically; otherwise hold until an operator resolves. A new single-side
    // edit must NOT auto-apply — it could clobber the other side's flagged change.
    if (link.status === "conflict") {
      if (analysis.outcome === "converged" || analysis.outcome === "neither") {
        await upsertLink(db, { entityType: "invoice", internalId, qboId: qboState.Id, lastSyncedHash: hash, lastInternalVersion: invoice.version, lastQboVersion: Number(qboState.SyncToken), lastSyncedSnapshot: canonicalFromInternal(invoice), status: "linked" }, now);
        await writeAudit(db, { ...base, action: "skip", result: "ok", error: "conflict cleared (sides converged)" }, now);
      } else {
        await writeAudit(db, { ...base, action: "skip", result: "ok", error: "held: link in conflict; awaiting resolution" }, now);
      }
      return;
    }

    const action = actionFor("internal", analysis);
    if (action === "conflict") {
      await markLinkConflict(db, link.id, now);
      await writeAudit(db, { ...base, action: "conflict", before: { amountCents: snapshot?.amountCents }, after: { internalAmountCents: invoice.amountCents, qboAmountCents: qboState.totalCents }, result: "ok" }, now);
      return;
    }
    if (action === "skip") {
      // Internal touched only a non-synced field (customerName), or QBO drifted alone:
      // don't push internal's amount over QBO. Refresh the hash; keep the snapshot.
      await upsertLink(db, { entityType: "invoice", internalId, qboId: qboState.Id, lastSyncedHash: hash, lastInternalVersion: invoice.version, status: "linked" }, now);
      await writeAudit(db, { ...base, action: "skip", result: "ok", error: "no syncable field changed" }, now);
      return;
    }
    if (action === "converged") {
      await upsertLink(db, { entityType: "invoice", internalId, qboId: qboState.Id, lastSyncedHash: hash, lastInternalVersion: invoice.version, lastQboVersion: Number(qboState.SyncToken), lastSyncedSnapshot: canonicalFromInternal(invoice), status: "linked" }, now);
      await writeAudit(db, { ...base, action: "skip", result: "ok", error: "converged (both sides match)" }, now);
      return;
    }
    // action === "apply" → fall through to the update path.
  }

  // Apply: create / adopt / update QBO.
  deps.faultInjector?.();
  const body = mapInvoiceToQbo(invoice, deps.defaults);
  let qboId: string;
  let qboVersion: number;
  let action: "create" | "update";

  if (link?.qboId && qboState) {
    const updated = await deps.qbo.update({ ...body, Id: qboState.Id, SyncToken: qboState.SyncToken });
    qboId = updated.Id;
    qboVersion = Number(updated.SyncToken);
    action = "update";
  } else {
    const existing = await deps.qbo.findByDocNumber(internalId);
    if (existing) {
      // Created on a prior attempt whose link write was lost (timeout after the
      // external write). Adopt it and reflect current state — no duplicate.
      const updated = await deps.qbo.update({ ...body, Id: existing.Id, SyncToken: existing.SyncToken });
      qboId = updated.Id;
      qboVersion = Number(updated.SyncToken);
      action = "update";
    } else {
      const created = await deps.qbo.create(body, `internal:${internalId}:${invoice.version}`);
      qboId = created.Id;
      qboVersion = Number(created.SyncToken);
      action = "create";
    }
  }

  await upsertLink(db, { entityType: "invoice", internalId, qboId, lastSyncedHash: hash, lastInternalVersion: invoice.version, lastQboVersion: qboVersion, lastSyncedSnapshot: canonicalFromInternal(invoice), status: "linked" }, now);
  await writeAudit(db, { ...base, action, before: link ? { qboId: link.qboId } : undefined, after: { qboId, hash }, result: "ok" }, now);
}
