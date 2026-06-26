import type { InternalInvoice } from "../internal/service";
import type { SyncEventRow } from "./processor";
import type { Database } from "../../db/types";
import { writeAudit } from "./audit";
import { getLinkByQboId, upsertLink } from "./links";
import { hashInvoice } from "./mapping";
import type { QboInvoiceOps } from "./qbo-ops";

// How the reverse direction writes back into the internal system. Injected so the
// processor stays testable; production wires these to the internal service (which
// emits the internal change webhook — see the echo note below).
export interface InternalApply {
  updateAmount(id: string, amountCents: number): Promise<InternalInvoice>;
  remove(id: string): Promise<InternalInvoice>;
}

export interface ReverseDeps {
  qbo: Pick<QboInvoiceOps, "read">;
  internal: InternalApply;
}

// Apply one QBO-sourced invoice change to the internal system. The loop-prevention
// money shot lives here: our own write to QBO (internal → QBO) bumps the QBO
// SyncToken and we record it on the link, so the webhook QBO fires for *that* write
// comes back with a version we've already seen and is dropped as an echo. A genuine
// edit made in QBO carries a higher version and is applied.
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

  // Echo / loop prevention: a change at or below the version we last wrote back is
  // our own echo (or a stale, out-of-order delivery). Drop it.
  const seenVersion = link.lastQboVersion ?? -1;
  const incomingVersion = Number(state.SyncToken);
  if (incomingVersion <= seenVersion) {
    await writeAudit(
      db,
      { eventId: event.eventId, entityType: "invoice", entityExternalId: link.internalId, action: "skip", result: "ok", error: "echo: own write-back or stale QBO version", correlationId },
      now,
    );
    return;
  }

  const internalId = link.internalId;
  let applied: InternalInvoice;
  let action: "update" | "void";
  if (state.voided) {
    // Voided in QBO → deleted internally (the mirror of internal delete → QBO void).
    applied = await deps.internal.remove(internalId);
    action = "void";
  } else {
    applied = await deps.internal.updateAmount(internalId, state.totalCents);
    action = "update";
  }

  // Record the new fingerprint and the QBO version we just observed. The internal
  // write above emits an internal change webhook; when that loops back through the
  // internal → QBO worker it refetches the same state, the hash matches, and it's
  // short-circuited — closing the loop on the internal side too.
  const hash = hashInvoice(applied);
  await upsertLink(
    db,
    { entityType: "invoice", internalId, qboId, lastSyncedHash: hash, lastInternalVersion: applied.version, lastQboVersion: incomingVersion, status: "linked" },
    now,
  );
  await writeAudit(
    db,
    { eventId: event.eventId, entityType: "invoice", entityExternalId: internalId, action, before: { qboId, version: seenVersion }, after: { qboId, version: incomingVersion, totalCents: state.totalCents, hash }, result: "ok", correlationId },
    now,
  );
}
