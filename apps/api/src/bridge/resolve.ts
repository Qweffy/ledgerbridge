import type { Database } from "../../db/types";
import type { InternalInvoice } from "../internal/service";
import { writeAudit } from "./audit";
import { canonicalFromInternal } from "./conflict";
import { getLinkById, upsertLink } from "./links";
import { hashInvoice, mapInvoiceToQbo, type QboInvoiceDefaults } from "./mapping";
import type { QboInvoiceOps } from "./qbo-ops";
import type { InternalApply } from "./reverse";

export type ConflictWinner = "internal" | "quickbooks";

export interface ResolveDeps {
  qbo: QboInvoiceOps;
  internal: InternalApply;
  refetchInternal: (id: string) => Promise<InternalInvoice | undefined>;
  defaults: QboInvoiceDefaults;
}

export class ResolveError extends Error {}

// Operator-driven resolution of a flagged same-field conflict: apply the chosen
// side's CURRENT state to the other (re-read — the flag-time values may be stale),
// then clear the link back to `linked`. The link is written AFTER the apply, so the
// echo that apply triggers is absorbed by the existing hash/version skips.
export async function resolveConflict(
  db: Database,
  linkId: number,
  winner: ConflictWinner,
  deps: ResolveDeps,
  now: Date = new Date(),
): Promise<void> {
  const link = await getLinkById(db, linkId);
  if (!link) throw new ResolveError(`link ${linkId} not found`);
  if (link.status !== "conflict") throw new ResolveError(`link ${linkId} is not in conflict`);
  if (!link.internalId || !link.qboId) throw new ResolveError(`link ${linkId} is not fully mapped`);
  const internalId = link.internalId;
  const qboId = link.qboId;

  const internal = await deps.refetchInternal(internalId);
  if (!internal) throw new ResolveError(`internal invoice ${internalId} not found`);
  const qboState = await deps.qbo.read(qboId);

  const before = { internalAmountCents: internal.amountCents, qboAmountCents: qboState.totalCents };
  const base = { eventId: `resolve:${linkId}`, entityType: "invoice" as const, entityExternalId: internalId, correlationId: `resolve:${linkId}` };

  if (winner === "internal") {
    const body = mapInvoiceToQbo(internal, deps.defaults);
    const updated = await deps.qbo.update({ ...body, Id: qboState.Id, SyncToken: qboState.SyncToken });
    await upsertLink(db, { entityType: "invoice", internalId, qboId, lastSyncedHash: hashInvoice(internal), lastInternalVersion: internal.version, lastQboVersion: Number(updated.SyncToken), lastSyncedSnapshot: canonicalFromInternal(internal), status: "linked" }, now);
    await writeAudit(db, { ...base, action: "conflict_resolved", before, after: { winner, amountCents: internal.amountCents }, result: "ok" }, now);
    return;
  }

  // winner === "quickbooks": apply QBO's amount to the internal invoice.
  const applied = await deps.internal.updateAmount(internalId, qboState.totalCents);
  await upsertLink(db, { entityType: "invoice", internalId, qboId, lastSyncedHash: hashInvoice(applied), lastInternalVersion: applied.version, lastQboVersion: Number(qboState.SyncToken), lastSyncedSnapshot: canonicalFromInternal(applied), status: "linked" }, now);
  await writeAudit(db, { ...base, action: "conflict_resolved", before, after: { winner, amountCents: applied.amountCents }, result: "ok" }, now);
}
