import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncEvents } from "../../db/schema";
import { createTestDb, type TestDb } from "../helpers/db";
import { createFakeQbo } from "../helpers/fake-qbo";
import { createInvoice, deleteInvoice, getInvoice, listInvoices, updateInvoice } from "../../src/internal/service";
import type { ChangeEvent, ChangeSink } from "../../src/internal/sink";
import { enqueueInternalEvent } from "../../src/bridge/ingest";
import { getLinkByInternalId } from "../../src/bridge/links";
import { processOne, type WorkerDeps } from "../../src/bridge/worker";
import type { ReconcileDeps } from "../../src/bridge/reconcile";
import { buildServer } from "../../src/server";
import type { DemoDeps, FaultBox } from "../../src/demo/routes";

function captureSink(): { sink: ChangeSink; events: ChangeEvent[] } {
  const events: ChangeEvent[] = [];
  return { sink: { emit: async (e) => void events.push(e) }, events };
}

const MAX = 2;

describe("demo control endpoints", () => {
  let h: TestDb;
  let fake: ReturnType<typeof createFakeQbo>;
  let sink: ChangeSink;
  let events: ChangeEvent[];
  let faultBox: FaultBox;
  let deps: WorkerDeps;
  let recon: ReconcileDeps;
  let demoDeps: DemoDeps;

  beforeEach(async () => {
    h = await createTestDb();
    fake = createFakeQbo();
    const cap = captureSink();
    sink = cap.sink;
    events = cap.events;
    faultBox = { remaining: 0 };
    const internalApply = {
      updateAmount: (id: string, amountCents: number) => updateInvoice(h.db, sink, id, { amountCents }),
      remove: (id: string) => deleteInvoice(h.db, sink, id),
    };
    deps = {
      workerId: "test",
      maxAttempts: MAX,
      processor: {
        refetchInternalInvoice: (id) => getInvoice(h.db, id),
        qbo: fake.ops,
        defaults: { customerRef: "1", itemRef: "1" },
        applyToInternal: internalApply,
        // mirrors the closure index.ts wires into the live worker
        faultInjector: () => {
          if (faultBox.remaining > 0) {
            faultBox.remaining -= 1;
            throw new Error("injected fault (demo)");
          }
        },
      },
    };
    recon = {
      qbo: fake.ops,
      refetchInternal: (id) => getInvoice(h.db, id),
      listInternalInvoices: () => listInvoices(h.db),
      realmId: "r1",
    };
    demoDeps = {
      db: h.db,
      sink,
      qbo: { invoiceOps: fake.ops, defaults: { customerRef: "1", itemRef: "1" }, reconcile: recon, faultBox, maxAttempts: MAX },
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
    if (!qboId) throw new Error("expected a QBO id");
    return { id: inv.id, qboId };
  }

  it("POST /demo/create-invoice — creates one internal invoice (201)", async () => {
    const app = buildServer({ db: h.db, sink, demo: demoDeps });
    const res = await app.inject({ method: "POST", url: "/demo/create-invoice" });
    expect(res.statusCode).toBe(201);
    expect(res.json().ok).toBe(true);
    expect(await listInvoices(h.db)).toHaveLength(1);
    await app.close();
  });

  it("POST /demo/edit-both — diverges both sides → the link flips to conflict", async () => {
    const { id } = await syncNewInvoice(10000);
    const app = buildServer({ db: h.db, sink, demo: demoDeps });

    const res = await app.inject({ method: "POST", url: "/demo/edit-both" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    // the endpoint did the internal edit (emitted) + the QBO edit (direct); the
    // worker's next pass sees both-changed vs the snapshot and flags the conflict.
    await enqueueInternalEvent(h.db, lastEvent());
    await processOne(h.db, deps);
    expect((await getLinkByInternalId(h.db, "invoice", id))?.status).toBe("conflict");
    await app.close();
  });

  it("POST /demo/inject-fault — arms the fault; the victim event dead-letters", async () => {
    const app = buildServer({ db: h.db, sink, demo: demoDeps });

    const res = await app.inject({ method: "POST", url: "/demo/inject-fault" });
    expect(res.statusCode).toBe(200);
    expect(faultBox.remaining).toBe(MAX); // armed

    // drive the victim through the worker with the fault armed; advance past the
    // backoff so the retry is claimable, exhausting attempts → dead-letter. t0 sits
    // just after the row's insert time so the first pass claims it.
    await enqueueInternalEvent(h.db, lastEvent());
    const t0 = new Date(Date.now() + 1_000);
    await processOne(h.db, { ...deps, now: () => t0 });
    await processOne(h.db, { ...deps, now: () => new Date(t0.getTime() + 60_000) });

    const [row] = await h.db.select().from(syncEvents).where(eq(syncEvents.entityExternalId, String(res.json().invoiceId)));
    expect(row?.status).toBe("dead");
    expect(faultBox.remaining).toBe(0); // budget drained, system recovers
    await app.close();
  });

  it("POST /demo/reconcile — runs a pass (200)", async () => {
    await syncNewInvoice(10000);
    const app = buildServer({ db: h.db, sink, demo: demoDeps });
    const res = await app.inject({ method: "POST", url: "/demo/reconcile" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    await app.close();
  });

  it("QBO-touching actions 503 without QBO; create-invoice still works", async () => {
    const app = buildServer({ db: h.db, sink, demo: { db: h.db, sink } });
    for (const url of ["/demo/reconcile", "/demo/edit-both", "/demo/inject-fault"]) {
      expect((await app.inject({ method: "POST", url })).statusCode).toBe(503);
    }
    expect((await app.inject({ method: "POST", url: "/demo/create-invoice" })).statusCode).toBe(201);
    await app.close();
  });
});
