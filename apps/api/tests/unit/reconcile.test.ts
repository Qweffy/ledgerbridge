import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditLog, syncEvents } from "../../db/schema";
import { createTestDb, type TestDb } from "../helpers/db";
import { createFakeQbo } from "../helpers/fake-qbo";
import {
  createInvoice,
  deleteInvoice,
  getInvoice,
  listInvoices,
  updateInvoice,
} from "../../src/internal/service";
import type { ChangeEvent, ChangeSink } from "../../src/internal/sink";
import { enqueueInternalEvent } from "../../src/bridge/ingest";
import { getLinkByInternalId } from "../../src/bridge/links";
import { processOne, type WorkerDeps } from "../../src/bridge/worker";
import { reconcileOnce, type ReconcileDeps } from "../../src/bridge/reconcile";
import { resolveConflict, type ResolveDeps } from "../../src/bridge/resolve";

function captureSink(): { sink: ChangeSink; events: ChangeEvent[] } {
  const events: ChangeEvent[] = [];
  return { sink: { emit: async (e) => void events.push(e) }, events };
}

async function reconcileEventIds(h: TestDb): Promise<string[]> {
  const rows = await h.db.select({ eventId: syncEvents.eventId }).from(syncEvents);
  return rows.map((r) => r.eventId).filter((id) => id.startsWith("reconcile:"));
}

describe("bridge — reconciler (backfill + drift)", () => {
  let h: TestDb;
  let fake: ReturnType<typeof createFakeQbo>;
  let sink: ChangeSink;
  let events: ChangeEvent[];
  let deps: WorkerDeps;
  let recon: ReconcileDeps;
  let resolveDeps: ResolveDeps;

  beforeEach(async () => {
    h = await createTestDb();
    fake = createFakeQbo();
    const cap = captureSink();
    sink = cap.sink;
    events = cap.events;
    const internalApply = {
      updateAmount: (id: string, amountCents: number) => updateInvoice(h.db, sink, id, { amountCents }),
      remove: (id: string) => deleteInvoice(h.db, sink, id),
    };
    deps = {
      workerId: "test",
      processor: {
        refetchInternalInvoice: (id) => getInvoice(h.db, id),
        qbo: fake.ops,
        defaults: { customerRef: "1", itemRef: "1" },
        applyToInternal: internalApply,
      },
    };
    recon = {
      qbo: fake.ops,
      refetchInternal: (id) => getInvoice(h.db, id),
      listInternalInvoices: () => listInvoices(h.db),
      realmId: "r1",
    };
    resolveDeps = {
      qbo: fake.ops,
      internal: internalApply,
      refetchInternal: (id) => getInvoice(h.db, id),
      defaults: { customerRef: "1", itemRef: "1" },
    };
  });
  afterEach(async () => {
    await h.close();
  });

  function lastEvent(): ChangeEvent {
    const e = events[events.length - 1];
    if (!e) throw new Error("expected an internal event");
    return e;
  }

  async function syncNewInvoice(amountCents: number): Promise<{ id: string; qboId: string }> {
    const inv = await createInvoice(h.db, sink, { customerName: "Acme", amountCents });
    await enqueueInternalEvent(h.db, lastEvent());
    await processOne(h.db, deps);
    const qboId = fake.byDoc.get(inv.id);
    if (!qboId) throw new Error("expected a QBO id after first sync");
    return { id: inv.id, qboId };
  }

  function audits() {
    return h.db.select().from(auditLog);
  }

  it("flow #9 — matches an unlinked invoice to its QBO twin by DocNumber + amount", async () => {
    const inv = await createInvoice(h.db, sink, { customerName: "Acme", amountCents: 10000 });
    const seededId = fake.seed(inv.id, 10000); // exists in QBO, never linked

    const summary = await reconcileOnce(h.db, recon);
    expect(summary.matched).toBe(1);

    const link = await getLinkByInternalId(h.db, "invoice", inv.id);
    expect(link?.qboId).toBe(seededId);
    expect(link?.status).toBe("linked");
  });

  it("flags an ambiguous match (two QBO invoices, same DocNumber) without linking", async () => {
    const inv = await createInvoice(h.db, sink, { customerName: "Acme", amountCents: 10000 });
    fake.seed(inv.id, 10000);
    fake.seed(inv.id, 10000);

    await reconcileOnce(h.db, recon);

    expect(await getLinkByInternalId(h.db, "invoice", inv.id)).toBeUndefined();
    const conflicts = (await audits()).filter((a) => a.error?.includes("ambiguous"));
    expect(conflicts.length).toBe(1);
  });

  it("flags a docNumber match with a different amount as a conflict (resolvable via M6)", async () => {
    const inv = await createInvoice(h.db, sink, { customerName: "Acme", amountCents: 10000 });
    const seededId = fake.seed(inv.id, 30000); // same docNumber, different amount

    await reconcileOnce(h.db, recon);
    const link = await getLinkByInternalId(h.db, "invoice", inv.id);
    expect(link?.status).toBe("conflict");
    expect((await audits()).some((a) => a.error?.includes("amount mismatch"))).toBe(true);

    // the M6 operator path clears it
    if (!link) throw new Error("expected a link");
    await resolveConflict(h.db, link.id, "internal", resolveDeps);
    expect(fake.byId.get(seededId)?.totalCents).toBe(10000);
    expect((await getLinkByInternalId(h.db, "invoice", inv.id))?.status).toBe("linked");
  });

  it("flow #10 — recovers a dropped create: unlinked invoice, no QBO twin → synthetic event → created", async () => {
    const inv = await createInvoice(h.db, sink, { customerName: "Acme", amountCents: 10000 });
    // its create webhook was dropped: no link, no QBO invoice, no queued event

    const summary = await reconcileOnce(h.db, recon);
    expect(summary.driftEnqueued).toBe(1);
    expect(await reconcileEventIds(h)).toContain(`reconcile:internal:${inv.id}:1`);

    await processOne(h.db, deps); // the worker creates the QBO invoice
    expect(fake.createCalls).toBe(1);
    expect(await getLinkByInternalId(h.db, "invoice", inv.id)).toBeDefined();
  });

  it("flow #10 — catches QBO drift from a dropped webhook and enqueues a synthetic event", async () => {
    const { id, qboId } = await syncNewInvoice(10000);
    fake.externalEdit(qboId, { totalCents: 25000 }); // edited in QBO; the webhook was dropped

    const summary = await reconcileOnce(h.db, recon);
    expect(summary.driftEnqueued).toBe(1);
    expect(await reconcileEventIds(h)).toContain(`reconcile:qbo:${qboId}:1`);

    await processOne(h.db, deps); // the worker applies the QBO change to internal
    expect((await getInvoice(h.db, id))?.amountCents).toBe(25000);
  });

  it("is idempotent — a second pass over the same drift enqueues nothing new", async () => {
    const { qboId } = await syncNewInvoice(10000);
    fake.externalEdit(qboId, { totalCents: 25000 });

    await reconcileOnce(h.db, recon);
    await reconcileOnce(h.db, recon);

    const reconQbo = (await reconcileEventIds(h)).filter((id) => id.startsWith(`reconcile:qbo:${qboId}:`));
    expect(reconQbo.length).toBe(1);
  });

  it("skips an entity that already has an in-flight event (no thrash with the worker)", async () => {
    await createInvoice(h.db, sink, { customerName: "Acme", amountCents: 10000 });
    await enqueueInternalEvent(h.db, lastEvent()); // queued, not yet processed

    const summary = await reconcileOnce(h.db, recon);
    expect(summary.scanned).toBe(0); // skipped before scanning
    expect(await reconcileEventIds(h)).toHaveLength(0); // no synthetic event
  });

  it("a healthy synced link is a no-op, and every pass writes one heartbeat", async () => {
    await syncNewInvoice(10000);

    const summary = await reconcileOnce(h.db, recon);
    expect(summary.matched).toBe(0);
    expect(summary.driftEnqueued).toBe(0);
    expect(await reconcileEventIds(h)).toHaveLength(0);

    const heartbeats = (await audits()).filter((a) => a.correlationId === "reconcile:heartbeat");
    expect(heartbeats.length).toBe(1);
  });
});
