import { and, eq, inArray } from "drizzle-orm";
import { syncEvents } from "../../db/schema";
import type { Database } from "../../db/types";
import type { InternalInvoice } from "../internal/service";
import { writeAudit } from "./audit";
import { canonicalFromInternal } from "./conflict";
import { enqueueInternalEvent } from "./ingest";
import { getLinkByInternalId, getLinkByQboId, listLinks, upsertLink } from "./links";
import { hashInvoice } from "./mapping";
import type { QboInvoiceOps } from "./qbo-ops";

export interface ReconcileDeps {
  qbo: Pick<QboInvoiceOps, "read" | "listByDocNumber">;
  refetchInternal: (id: string) => Promise<InternalInvoice | undefined>;
  listInternalInvoices: () => Promise<InternalInvoice[]>;
  realmId: string;
  now?: () => Date;
}

export interface ReconcileSummary {
  scanned: number;
  matched: number;
  flagged: number;
  driftEnqueued: number;
  links: number;
}

// The worker may already be handling this entity. If a sync_event is in flight, the
// reconciler must not re-enqueue or re-flag — it would thrash against the worker.
async function hasPendingEvent(db: Database, externalId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: syncEvents.id })
    .from(syncEvents)
    .where(and(eq(syncEvents.entityExternalId, externalId), inArray(syncEvents.status, ["pending", "processing"])))
    .limit(1);
  return row !== undefined;
}

// A synthetic internal event re-runs the forward sync for an invoice whose change we
// missed (a dropped webhook) — idempotent via the version-stamped event id.
function enqueueInternalResync(db: Database, inv: InternalInvoice, now: Date): Promise<"enqueued" | "duplicate"> {
  return enqueueInternalEvent(db, {
    eventId: `reconcile:internal:${inv.id}:${inv.version}`,
    entity: "invoice",
    entityId: inv.id,
    changeType: "update",
    version: inv.version,
    occurredAt: now.toISOString(),
  });
}

// A synthetic QBO event in its OWN namespace (not the webhook's qbo:invoice:… id, so
// the two never collide) — idempotent via the SyncToken-stamped event id.
async function enqueueQboResync(
  db: Database,
  qboId: string,
  syncToken: string,
  realmId: string,
): Promise<"enqueued" | "duplicate"> {
  const eventId = `reconcile:qbo:${qboId}:${syncToken}`;
  const inserted = await db
    .insert(syncEvents)
    .values({
      eventId,
      source: "quickbooks",
      entityType: "invoice",
      entityExternalId: qboId,
      payload: { qboId, syncToken, realmId, reconcile: true },
      correlationId: eventId,
    })
    .onConflictDoNothing({ target: syncEvents.eventId })
    .returning({ id: syncEvents.id });
  return inserted.length > 0 ? "enqueued" : "duplicate";
}

// Part A — match invoices that exist on both sides with no link, by DocNumber (= the
// internal id we write to QBO) + amount. Ambiguity or a mismatch is flagged, never
// blindly linked. An internal invoice with no QBO match gets a synthetic resync (it
// recovers a dropped create — the invoice never reached QBO).
async function reconcileUnlinked(
  db: Database,
  deps: ReconcileDeps,
  now: Date,
): Promise<{ scanned: number; matched: number; flagged: number; driftEnqueued: number }> {
  let scanned = 0;
  let matched = 0;
  let flagged = 0;
  let driftEnqueued = 0;

  for (const inv of await deps.listInternalInvoices()) {
    if (inv.status === "deleted") continue;
    if (await getLinkByInternalId(db, "invoice", inv.id)) continue;
    if (await hasPendingEvent(db, inv.id)) continue;
    scanned += 1;

    const all = await deps.qbo.listByDocNumber(inv.id);
    const candidates = [];
    for (const m of all) {
      if (!(await getLinkByQboId(db, "invoice", m.Id))) candidates.push(m);
    }

    if (candidates.length === 0) {
      if ((await enqueueInternalResync(db, inv, now)) === "enqueued") driftEnqueued += 1;
      continue;
    }
    if (candidates.length > 1) {
      flagged += 1;
      await writeAudit(db, { entityType: "invoice", entityExternalId: inv.id, action: "conflict", result: "ok", error: `reconcile: ambiguous (${candidates.length} matches)`, correlationId: `reconcile:${inv.id}` }, now);
      continue;
    }

    const [m] = candidates;
    if (!m) continue;
    if (m.totalCents === inv.amountCents) {
      await upsertLink(db, { entityType: "invoice", internalId: inv.id, qboId: m.Id, lastSyncedHash: hashInvoice(inv), lastInternalVersion: inv.version, lastQboVersion: Number(m.SyncToken), lastSyncedSnapshot: canonicalFromInternal(inv), status: "linked" }, now);
      matched += 1;
      await writeAudit(db, { entityType: "invoice", entityExternalId: inv.id, action: "create", before: { reconcile: "matched by docNumber" }, after: { qboId: m.Id }, result: "ok", correlationId: `reconcile:${inv.id}` }, now);
    } else {
      await upsertLink(db, { entityType: "invoice", internalId: inv.id, qboId: m.Id, lastSyncedHash: hashInvoice(inv), lastInternalVersion: inv.version, lastQboVersion: Number(m.SyncToken), status: "conflict" }, now);
      flagged += 1;
      await writeAudit(db, { entityType: "invoice", entityExternalId: inv.id, action: "conflict", before: { internalAmountCents: inv.amountCents }, after: { qboId: m.Id, qboAmountCents: m.totalCents }, result: "ok", error: "reconcile: docNumber match, amount mismatch", correlationId: `reconcile:${inv.id}` }, now);
    }
  }

  return { scanned, matched, flagged, driftEnqueued };
}

// Part B — for each linked invoice, refetch both sides; a version/hash that has moved
// past what we last synced is a missed change (a dropped webhook). Enqueue a synthetic
// event so the idempotent worker re-converges it.
async function reconcileDrift(
  db: Database,
  deps: ReconcileDeps,
  now: Date,
): Promise<{ links: number; driftEnqueued: number }> {
  let links = 0;
  let driftEnqueued = 0;

  for (const link of await listLinks(db, "invoice", "linked")) {
    if (!link.internalId || !link.qboId) continue;
    if ((await hasPendingEvent(db, link.internalId)) || (await hasPendingEvent(db, link.qboId))) continue;
    links += 1;

    const state = await deps.qbo.read(link.qboId);
    if (Number(state.SyncToken) > (link.lastQboVersion ?? -1)) {
      if ((await enqueueQboResync(db, link.qboId, state.SyncToken, deps.realmId)) === "enqueued") driftEnqueued += 1;
    }

    const inv = await deps.refetchInternal(link.internalId);
    if (inv && hashInvoice(inv) !== link.lastSyncedHash) {
      if ((await enqueueInternalResync(db, inv, now)) === "enqueued") driftEnqueued += 1;
    }
  }

  return { links, driftEnqueued };
}

// One reconcile pass: match unlinked + recover drift, then a single heartbeat audit
// row so observability can tell "healthy + idle" from "reconciler dead".
export async function reconcileOnce(db: Database, deps: ReconcileDeps): Promise<ReconcileSummary> {
  const now = deps.now?.() ?? new Date();
  const a = await reconcileUnlinked(db, deps, now);
  const b = await reconcileDrift(db, deps, now);
  const summary: ReconcileSummary = {
    scanned: a.scanned,
    matched: a.matched,
    flagged: a.flagged,
    driftEnqueued: a.driftEnqueued + b.driftEnqueued,
    links: b.links,
  };
  await writeAudit(db, { entityType: "invoice", entityExternalId: "reconcile", action: "skip", after: { ...summary }, result: "ok", correlationId: "reconcile:heartbeat" }, now);
  return summary;
}

export interface RunningReconciler {
  stop: () => Promise<void>;
}

// Periodic loop (mirrors startWorker): runs a pass immediately, then every intervalMs,
// with a graceful stop that lets the in-flight pass finish.
export function startReconciler(
  db: Database,
  deps: ReconcileDeps & { intervalMs?: number; onError?: (err: unknown) => void },
): RunningReconciler {
  const intervalMs = deps.intervalMs ?? 5 * 60 * 1000;
  let stopped = false;
  let current: Promise<unknown> = Promise.resolve();

  async function loop(): Promise<void> {
    while (!stopped) {
      try {
        current = reconcileOnce(db, deps);
        await current;
      } catch (err) {
        deps.onError?.(err);
      }
      await sleep(intervalMs);
    }
  }
  void loop();

  return {
    async stop() {
      stopped = true;
      await current;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
