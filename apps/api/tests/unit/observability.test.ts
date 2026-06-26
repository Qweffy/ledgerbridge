import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  auditEntryDtoSchema,
  conflictDtoSchema,
  eventDtoSchema,
  linkDtoSchema,
  statusDtoSchema,
} from "@ledgerbridge/shared";
import { syncEvents } from "../../db/schema";
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
import { enqueueQboEvent } from "../../src/bridge/qbo-ingest";
import { getLinkByInternalId } from "../../src/bridge/links";
import { processOne, type WorkerDeps } from "../../src/bridge/worker";
import { reconcileOnce, type ReconcileDeps } from "../../src/bridge/reconcile";
import type { ResolveDeps } from "../../src/bridge/resolve";
import { buildServer } from "../../src/server";

function captureSink(): { sink: ChangeSink; events: ChangeEvent[] } {
  const events: ChangeEvent[] = [];
  return { sink: { emit: async (e) => void events.push(e) }, events };
}

describe("observability API", () => {
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

  function server() {
    return buildServer({ db: h.db, sink, resolve: resolveDeps });
  }

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

  async function setupConflict(): Promise<string> {
    const { id, qboId } = await syncNewInvoice(10000);
    await updateInvoice(h.db, sink, id, { amountCents: 20000 });
    await enqueueInternalEvent(h.db, lastEvent());
    fake.externalEdit(qboId, { totalCents: 30000 });
    await enqueueQboEvent(h.db, { qboId, lastUpdated: "2026-06-26T10:00:00Z", operation: "Update", realmId: "r1" });
    await processOne(h.db, deps); // flags conflict
    return id;
  }

  it("GET /status — counts (all four keys), conflictCount, lastReconcileAt, null lag when idle", async () => {
    await syncNewInvoice(10000);
    await reconcileOnce(h.db, recon); // writes the heartbeat
    const app = server();

    const res = await app.inject({ method: "GET", url: "/status" });
    expect(res.statusCode).toBe(200);
    const body = statusDtoSchema.parse(res.json());
    expect(body.counts).toMatchObject({ pending: 0, processing: 0, done: 1, dead: 0 });
    expect(body.oldestPendingLagSec).toBeNull();
    expect(body.lastReconcileAt).not.toBeNull();
    await app.close();
  });

  it("GET /events — maps quickbooks→qbo, filters, and serves detail", async () => {
    await syncNewInvoice(10000); // one done internal event
    await enqueueQboEvent(h.db, { qboId: "QBO-9", lastUpdated: "2026-06-26T10:00:00Z", operation: "Update", realmId: "r1" });
    const app = server();

    const all = await app.inject({ method: "GET", url: "/events" });
    const list = all.json().map((e: unknown) => eventDtoSchema.parse(e));
    expect(list.length).toBe(2);
    expect(list.some((e: { source: string }) => e.source === "qbo")).toBe(true);
    expect(list.every((e: { maxAttempts: number }) => e.maxAttempts === 8)).toBe(true);

    const qbo = await app.inject({ method: "GET", url: "/events?source=qbo" });
    expect(qbo.json().length).toBe(1);
    const done = await app.inject({ method: "GET", url: "/events?status=done" });
    expect(done.json().length).toBe(1);
    expect(done.json()[0].operation).toBe("create"); // from the internal changeType

    const detail = await app.inject({ method: "GET", url: `/events/${done.json()[0].id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().payload).toBeTruthy();
    expect(Array.isArray(detail.json().auditTrail)).toBe(true);
    await app.close();
  });

  it("GET /links — snapshots + drift flag; 404 for an unknown id", async () => {
    const { id, qboId } = await syncNewInvoice(10000);
    const app = server();

    const list = await app.inject({ method: "GET", url: "/links" });
    const links = list.json().map((l: unknown) => linkDtoSchema.parse(l));
    expect(links.length).toBe(1);
    expect(links[0].status).toBe("linked");
    expect(links[0].drift).toBe(false);

    const link = await getLinkByInternalId(h.db, "invoice", id);
    const detail = await app.inject({ method: "GET", url: `/links/${link?.id}` });
    expect(detail.json().internalSnapshot.TotalAmount).toBe("100.00");
    expect(detail.json().qboSnapshot.TotalAmount).toBe("100.00");

    // drift: a reconcile resync queued for the link's QBO id
    fake.externalEdit(qboId, { totalCents: 25000 });
    await reconcileOnce(h.db, recon);
    const drifted = await app.inject({ method: "GET", url: "/links" });
    expect(drifted.json()[0].drift).toBe(true);

    expect((await app.inject({ method: "GET", url: "/links/99999" })).statusCode).toBe(404);
    await app.close();
  });

  it("GET /conflicts — from the flag-time audit (conflictingFields + before/after)", async () => {
    const id = await setupConflict();
    const app = server();

    const list = await app.inject({ method: "GET", url: "/conflicts" });
    const conflicts = list.json().map((c: unknown) => conflictDtoSchema.parse(c));
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].conflictingFields).toEqual(["TotalAmount"]);
    expect(conflicts[0].customer).toBe("Acme");

    const link = await getLinkByInternalId(h.db, "invoice", id);
    const detail = await app.inject({ method: "GET", url: `/conflicts/${link?.id}` });
    expect(detail.json().before.TotalAmount).toBe("200.00"); // internal
    expect(detail.json().after.TotalAmount).toBe("300.00"); // qbo
    await app.close();
  });

  it("POST /conflicts/:id/resolve — 503 without QBO, resolves with it, 409 on a non-conflict", async () => {
    const id = await setupConflict();
    const link = await getLinkByInternalId(h.db, "invoice", id);

    const noResolve = buildServer({ db: h.db, sink });
    const gated = await noResolve.inject({ method: "POST", url: `/conflicts/${link?.id}/resolve`, payload: { winner: "internal" } });
    expect(gated.statusCode).toBe(503);
    await noResolve.close();

    const app = server();
    const ok = await app.inject({ method: "POST", url: `/conflicts/${link?.id}/resolve`, payload: { winner: "internal" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ resolved: true, winner: "internal" });
    expect((await getLinkByInternalId(h.db, "invoice", id))?.status).toBe("linked");

    // resolving the now-linked link again → not in conflict → 409
    const again = await app.inject({ method: "POST", url: `/conflicts/${link?.id}/resolve`, payload: { winner: "qbo" } });
    expect(again.statusCode).toBe(409);
    await app.close();
  });

  it("POST /events/:id/replay — dead → pending + claimable; processing → 409", async () => {
    const [dead] = await h.db
      .insert(syncEvents)
      .values({ eventId: "dead:1", source: "internal", entityType: "invoice", entityExternalId: "INV-D", status: "dead", attempts: 3, payload: { changeType: "create" }, lastError: "boom" })
      .returning({ id: syncEvents.id });
    const [busy] = await h.db
      .insert(syncEvents)
      .values({ eventId: "busy:1", source: "internal", entityType: "invoice", entityExternalId: "INV-B", status: "processing", attempts: 1, payload: { changeType: "create" } })
      .returning({ id: syncEvents.id });
    const app = server();

    const replay = await app.inject({ method: "POST", url: `/events/${dead?.id}/replay` });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ status: "pending", replayed: true });
    const [row] = await h.db.select().from(syncEvents).where(eq(syncEvents.id, Number(dead?.id)));
    expect(row?.status).toBe("pending");
    expect(row?.attempts).toBe(0);

    const busyReplay = await app.inject({ method: "POST", url: `/events/${busy?.id}/replay` });
    expect(busyReplay.statusCode).toBe(409);
    await app.close();
  });

  it("GET /audit — rows parse against the shared contract", async () => {
    await syncNewInvoice(10000);
    const app = server();
    const res = await app.inject({ method: "GET", url: "/audit" });
    const rows = res.json().map((a: unknown) => auditEntryDtoSchema.parse(a));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((a: { action: string }) => a.action === "create")).toBe(true);
    await app.close();
  });
});
