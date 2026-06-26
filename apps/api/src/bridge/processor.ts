import { syncEvents } from "../../db/schema";
import type { Database } from "../../db/types";
import type { InternalInvoice } from "../internal/service";
import { writeAudit } from "./audit";
import { getLinkByInternalId, upsertLink } from "./links";
import { hashInvoice, mapInvoiceToQbo, type QboInvoiceDefaults } from "./mapping";
import type { QboInvoiceOps } from "./qbo-ops";

export type SyncEventRow = typeof syncEvents.$inferSelect;

export interface ProcessorDeps {
  // Refetch the current internal invoice (never trust the webhook payload).
  refetchInternalInvoice: (id: string) => Promise<InternalInvoice | undefined>;
  qbo: QboInvoiceOps;
  defaults: QboInvoiceDefaults;
  now?: () => Date;
}

// Apply one internal-invoice event to QBO, idempotently. The two load-bearing
// rules: refetch current state, and check-before-create by external id.
export async function processEvent(
  db: Database,
  event: SyncEventRow,
  deps: ProcessorDeps,
): Promise<void> {
  if (event.source !== "internal" || event.entityType !== "invoice") return; // payments / qbo-source: M5/M6

  const now = deps.now?.() ?? new Date();
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

  // delete → void (accounting voids, never hard-deletes)
  if (invoice.status === "deleted") {
    if (link?.qboId) {
      const ref = await deps.qbo.read(link.qboId);
      await deps.qbo.voidInvoice(ref.Id, ref.SyncToken);
      await upsertLink(db, { entityType: "invoice", internalId, qboId: link.qboId, lastSyncedHash: hash, lastInternalVersion: invoice.version, status: "linked" }, now);
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
  let action: "create" | "update";

  if (link?.qboId) {
    const ref = await deps.qbo.read(link.qboId);
    await deps.qbo.update({ ...body, Id: ref.Id, SyncToken: ref.SyncToken });
    qboId = ref.Id;
    action = "update";
  } else {
    const existing = await deps.qbo.findByDocNumber(internalId);
    if (existing) {
      // Created on a prior attempt whose link write was lost (timeout after the
      // external write). Adopt it and reflect current state — no duplicate.
      await deps.qbo.update({ ...body, Id: existing.Id, SyncToken: existing.SyncToken });
      qboId = existing.Id;
      action = "update";
    } else {
      const created = await deps.qbo.create(body, `internal:${internalId}:${invoice.version}`);
      qboId = created.Id;
      action = "create";
    }
  }

  await upsertLink(db, { entityType: "invoice", internalId, qboId, lastSyncedHash: hash, lastInternalVersion: invoice.version, status: "linked" }, now);
  await writeAudit(
    db,
    { eventId: event.eventId, entityType: "invoice", entityExternalId: internalId, action, before: link ? { qboId: link.qboId } : undefined, after: { qboId, hash }, result: "ok", correlationId },
    now,
  );
}
