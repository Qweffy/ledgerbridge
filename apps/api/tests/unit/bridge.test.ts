import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditLog, syncEvents } from "../../db/schema";
import { createTestDb, type TestDb } from "../helpers/db";
import {
  createInvoice,
  deleteInvoice,
  getInvoice,
  updateInvoice,
} from "../../src/internal/service";
import {
  noopSink,
  signPayload,
  type ChangeEvent,
  type ChangeSink,
} from "../../src/internal/sink";
import { enqueueInternalEvent } from "../../src/bridge/ingest";
import { getLinkByInternalId } from "../../src/bridge/links";
import { processOne, type WorkerDeps } from "../../src/bridge/worker";
import type { QboInvoiceOps } from "../../src/bridge/qbo-ops";
import { buildServer } from "../../src/server";

function captureSink(): { sink: ChangeSink; events: ChangeEvent[] } {
  const events: ChangeEvent[] = [];
  return { sink: { emit: async (e) => void events.push(e) }, events };
}

// In-memory QBO double: tracks invoices by Id and by DocNumber, counts real creates.
function createFakeQbo() {
  interface Inv {
    Id: string;
    SyncToken: string;
    DocNumber: string;
    voided: boolean;
  }
  const byId = new Map<string, Inv>();
  const byDoc = new Map<string, string>();
  let seq = 100;
  let createCalls = 0;

  const ops: QboInvoiceOps = {
    async findByDocNumber(docNumber) {
      const id = byDoc.get(docNumber);
      if (id === undefined) return undefined;
      const inv = byId.get(id);
      return inv ? { Id: inv.Id, SyncToken: inv.SyncToken } : undefined;
    },
    async create(invoice) {
      createCalls += 1;
      const id = String((seq += 1));
      const docNumber = String((invoice as { DocNumber?: unknown }).DocNumber ?? id);
      byId.set(id, { Id: id, SyncToken: "0", DocNumber: docNumber, voided: false });
      byDoc.set(docNumber, id);
      return { Id: id, SyncToken: "0" };
    },
    async read(id) {
      const inv = byId.get(id);
      if (!inv) throw new Error(`qbo invoice ${id} not found`);
      return { Id: inv.Id, SyncToken: inv.SyncToken };
    },
    async update(invoice) {
      const id = String((invoice as { Id?: unknown }).Id);
      const inv = byId.get(id);
      if (!inv) throw new Error(`qbo invoice ${id} not found`);
      inv.SyncToken = String(Number(inv.SyncToken) + 1);
      return { Id: inv.Id, SyncToken: inv.SyncToken };
    },
    async voidInvoice(id) {
      const inv = byId.get(id);
      if (inv) inv.voided = true;
    },
  };

  return {
    ops,
    byId,
    byDoc,
    get createCalls() {
      return createCalls;
    },
    // Pretend QBO already has an invoice (e.g. created on a lost attempt).
    seed(docNumber: string): string {
      const id = String((seq += 1));
      byId.set(id, { Id: id, SyncToken: "0", DocNumber: docNumber, voided: false });
      byDoc.set(docNumber, id);
      return id;
    },
  };
}

function first<T>(arr: T[]): T {
  const [v] = arr;
  if (v === undefined) throw new Error("expected at least one element");
  return v;
}

describe("bridge — internal → QBO sync core", () => {
  let h: TestDb;
  let fake: ReturnType<typeof createFakeQbo>;
  let deps: WorkerDeps;

  beforeEach(async () => {
    h = await createTestDb();
    fake = createFakeQbo();
    deps = {
      workerId: "test",
      processor: {
        refetchInternalInvoice: (id) => getInvoice(h.db, id),
        qbo: fake.ops,
        defaults: { customerRef: "1", itemRef: "1" },
      },
    };
  });
  afterEach(async () => {
    await h.close();
  });

  it("internal create → one QBO invoice; a re-delivered webhook is idempotent", async () => {
    const { sink, events } = captureSink();
    const inv = await createInvoice(h.db, sink, { customerName: "Acme", amountCents: 12480 });
    const event = first(events);

    expect(await enqueueInternalEvent(h.db, event)).toBe("enqueued");
    expect(await enqueueInternalEvent(h.db, event)).toBe("duplicate");

    expect(await processOne(h.db, deps)).toBe("processed");
    expect(fake.createCalls).toBe(1);
    expect(fake.byId.size).toBe(1);

    const link = await getLinkByInternalId(h.db, "invoice", inv.id);
    expect(link?.qboId).toBe(fake.byDoc.get(inv.id));
    expect(link?.status).toBe("linked");

    const [ev] = await h.db.select().from(syncEvents).where(eq(syncEvents.eventId, event.eventId));
    expect(ev?.status).toBe("done");
    expect(await processOne(h.db, deps)).toBe("idle");

    const audits = await h.db.select().from(auditLog);
    expect(audits.map((a) => a.action)).toContain("create");
  });

  it("editing the invoice updates QBO and never duplicates", async () => {
    const { sink, events } = captureSink();
    const inv = await createInvoice(h.db, sink, { customerName: "Acme", amountCents: 1000 });
    await enqueueInternalEvent(h.db, first(events));
    await processOne(h.db, deps);

    await updateInvoice(h.db, sink, inv.id, { amountCents: 2000 });
    await enqueueInternalEvent(h.db, events[1] as ChangeEvent);
    await processOne(h.db, deps);

    expect(fake.createCalls).toBe(1);
    expect(fake.byId.size).toBe(1);
  });

  it("timeout-after-write: an existing QBO invoice with no link is adopted, not duplicated (money shot)", async () => {
    const { sink, events } = captureSink();
    const inv = await createInvoice(h.db, sink, { customerName: "Acme", amountCents: 5000 });
    // QBO already has it (created last attempt) but our link write was lost.
    fake.seed(inv.id);
    expect(fake.createCalls).toBe(0);

    await enqueueInternalEvent(h.db, first(events));
    await processOne(h.db, deps);

    expect(fake.createCalls).toBe(0); // adopted, no new create
    expect(fake.byId.size).toBe(1);
    const link = await getLinkByInternalId(h.db, "invoice", inv.id);
    expect(link?.qboId).toBe(fake.byDoc.get(inv.id));
  });

  it("internal delete → voids the linked QBO invoice", async () => {
    const { sink, events } = captureSink();
    const inv = await createInvoice(h.db, sink, { customerName: "Acme", amountCents: 1000 });
    await enqueueInternalEvent(h.db, first(events));
    await processOne(h.db, deps);
    const qboId = fake.byDoc.get(inv.id);

    await deleteInvoice(h.db, sink, inv.id);
    await enqueueInternalEvent(h.db, events[1] as ChangeEvent);
    await processOne(h.db, deps);

    expect(qboId && fake.byId.get(qboId)?.voided).toBe(true);
    const audits = await h.db.select().from(auditLog);
    expect(audits.map((a) => a.action)).toContain("void");
  });

  it("a failing event retries with backoff, then dead-letters at max attempts", async () => {
    const { sink, events } = captureSink();
    await createInvoice(h.db, sink, { customerName: "Acme", amountCents: 1000 });
    const event = first(events);
    await enqueueInternalEvent(h.db, event);

    const t0 = new Date();
    const exploding: QboInvoiceOps = {
      ...fake.ops,
      async findByDocNumber() {
        return undefined;
      },
      async create() {
        throw new Error("boom");
      },
    };
    const failing: WorkerDeps = {
      ...deps,
      maxAttempts: 2,
      processor: { ...deps.processor, qbo: exploding },
      now: () => t0,
    };

    await processOne(h.db, failing);
    let [ev] = await h.db.select().from(syncEvents).where(eq(syncEvents.eventId, event.eventId));
    expect(ev?.status).toBe("pending");
    expect(ev?.attempts).toBe(1);
    expect(ev?.lastError).toContain("boom");

    const later: WorkerDeps = { ...failing, now: () => new Date(t0.getTime() + 60_000) };
    await processOne(h.db, later);
    [ev] = await h.db.select().from(syncEvents).where(eq(syncEvents.eventId, event.eventId));
    expect(ev?.status).toBe("dead");
    expect(ev?.attempts).toBe(2);
  });

  it("ingest verifies the HMAC signature and enqueues idempotently", async () => {
    const secret = "whsec";
    const app = buildServer({ db: h.db, sink: noopSink, bridge: { secret } });
    const event = {
      eventId: "internal:change:1",
      entity: "invoice",
      entityId: "INV-1",
      changeType: "create",
      version: 1,
      occurredAt: new Date().toISOString(),
    };
    const body = JSON.stringify(event);
    const sig = signPayload(body, secret);
    const headers = { "content-type": "application/json", "x-lb-signature": sig };

    const ok = await app.inject({ method: "POST", url: "/webhooks/internal", headers, payload: body });
    expect(ok.statusCode).toBe(202);
    expect(ok.json()).toMatchObject({ status: "enqueued" });

    const dup = await app.inject({ method: "POST", url: "/webhooks/internal", headers, payload: body });
    expect(dup.json()).toMatchObject({ status: "duplicate" });

    const bad = await app.inject({
      method: "POST",
      url: "/webhooks/internal",
      headers: { "content-type": "application/json", "x-lb-signature": "sha256=deadbeef" },
      payload: body,
    });
    expect(bad.statusCode).toBe(401);
    await app.close();
  });
});
