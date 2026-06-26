import { syncEvents } from "../../db/schema";
import type { Database } from "../../db/types";
import type { InternalInvoice } from "../internal/service";
import { writeAudit } from "./audit";
import { getLinkByInternalId, upsertLink } from "./links";
import { hashInvoice, mapInvoiceToQbo, type QboInvoiceDefaults } from "./mapping";
import type { QboInvoiceOps } from "./qbo-ops";
import { processQboToInternal, type InternalApply } from "./reverse";

export type SyncEventRow = typeof syncEvents.$inferSelect;

export interface ProcessorDeps {
  // Refetch the current internal invoice (never trust the webhook payload).
  refetchInternalInvoice: (id: string) => Promise<InternalInvoice | undefined>;
  qbo: QboInvoiceOps;
  defaults: QboInvoiceDefaults;
  // The reverse direction (QBO → internal). Optional: when unset, QBO-sourced
  // events are not applied (one-direction deployments).
  applyToInternal?: InternalApply;
  now?: () => Date;
}

// Route an event to the right direction by its source. Both directions are
// idempotent and audited; loop prevention is split across the two (version on the
// QBO side, hash on the internal side).
export async function processEvent(
  db: Database,
  event: SyncEventRow,
  deps: ProcessorDeps,
): Promise<void> {
  if (event.entityType !== "invoice") return;
  const now = deps.now?.() ?? new Date();

  if (event.source === "internal") {
    return processInternalToQbo(db, event, deps, now);
  }
  if (event.source === "quickbooks") {
    if (!deps.applyToInternal) return;
    return processQboToInternal(db, event, { qbo: deps.qbo, internal: deps.applyToInternal }, now);
  }
}

// Apply one internal-invoice event to QBO, idempotently. The two load-bearing
// rules: refetch current state, and check-before-create by external id.
async function processInternalToQbo(
  db: Database,
  event: SyncEventRow,
  deps: ProcessorDeps,
  now: Date,
): Promise<void> {
  const internalId = event.entityExternalId;
  const correlationId = event.correlationId ?? undefined;

  const invoice = await deps.refetchInternalInvoice(internalId);
  if (!invoice) {
    await writeAudit(
      db,
      { eventId: event.eventId, entityType: "invoice", entityExternalId: internalId, action: "skip", result: "ok", error: "internal invoice not found", correlationId },
      now,
    );
    return;
  }

  const link = await getLinkByInternalId(db, "invoice", internalId);
  const hash = hashInvoice(invoice);

  // Nothing changed since we last synced this entity: a re-delivery, or the echo of
  // a write the reverse direction just made into the internal system. Skip — no
  // redundant write, no re-void. This is the internal-side half of loop prevention.
  if (link && link.lastSyncedHash === hash && link.status === "linked") {
    await writeAudit(
      db,
      { eventId: event.eventId, entityType: "invoice", entityExternalId: internalId, action: "skip", result: "ok", error: "unchanged since last sync", correlationId },
      now,
    );
    return;
  }

  // delete → void (accounting voids, never hard-deletes)
  if (invoice.status === "deleted") {
    if (link?.qboId) {
      const ref = await deps.qbo.read(link.qboId);
      const voided = await deps.qbo.voidInvoice(ref.Id, ref.SyncToken);
      await upsertLink(db, { entityType: "invoice", internalId, qboId: link.qboId, lastSyncedHash: hash, lastInternalVersion: invoice.version, lastQboVersion: Number(voided.SyncToken), status: "linked" }, now);
      await writeAudit(
        db,
        { eventId: event.eventId, entityType: "invoice", entityExternalId: internalId, action: "void", before: { qboId: link.qboId }, after: { qboId: link.qboId, voided: true }, result: "ok", correlationId },
        now,
      );
    } else {
      await writeAudit(
        db,
        { eventId: event.eventId, entityType: "invoice", entityExternalId: internalId, action: "skip", result: "ok", error: "no linked QBO invoice to void", correlationId },
        now,
      );
    }
    return;
  }

  const body = mapInvoiceToQbo(invoice, deps.defaults);
  let qboId: string;
  let qboVersion: number;
  let action: "create" | "update";

  if (link?.qboId) {
    const ref = await deps.qbo.read(link.qboId);
    const updated = await deps.qbo.update({ ...body, Id: ref.Id, SyncToken: ref.SyncToken });
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

  await upsertLink(db, { entityType: "invoice", internalId, qboId, lastSyncedHash: hash, lastInternalVersion: invoice.version, lastQboVersion: qboVersion, status: "linked" }, now);
  await writeAudit(
    db,
    { eventId: event.eventId, entityType: "invoice", entityExternalId: internalId, action, before: link ? { qboId: link.qboId } : undefined, after: { qboId, hash }, result: "ok", correlationId },
    now,
  );
}
