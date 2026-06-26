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
import { buildServer } from "../../src/server";
import { createFakeQbo } from "../helpers/fake-qbo";

function captureSink(): { sink: ChangeSink; events: ChangeEvent[] } {
  const events: ChangeEvent[] = [];
  return { sink: { emit: async (e) => void events.push(e) }, events };
}

function first<T>(arr: T[]): T {
  const [v] = arr;
  if (v === undefined) throw new Error("expected at least one element");
  return v;
}

// Reach into a QBO invoice body's first line amount for assertions.
function lineAmount(body: Record<string, unknown> | undefined): number | undefined {
  const line = (body?.Line as Array<{ Amount?: number }> | undefined)?.[0];
  return line?.Amount;
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

  it("internal create → one QBO invoice with a stable request id; re-delivery is idempotent", async () => {
    const { sink, events } = captureSink();
    const inv = await createInvoice(h.db, sink, { customerName: "Acme", amountCents: 12480 });
    const event = first(events);

    expect(await enqueueInternalEvent(h.db, event)).toBe("enqueued");
    expect(await enqueueInternalEvent(h.db, event)).toBe("duplicate");

    expect(await processOne(h.db, deps)).toBe("processed");
    expect(fake.createCalls).toBe(1);
    expect(fake.byId.size).toBe(1);
    // the create carried a stable idempotency key (→ QBO Request-Id header)
    expect(fake.lastCreateRequestId).toBe(`internal:${inv.id}:1`);

    const link = await getLinkByInternalId(h.db, "invoice", inv.id);
    expect(link?.qboId).toBe(fake.byDoc.get(inv.id));
    expect(link?.status).toBe("linked");

    const [ev] = await h.db.select().from(syncEvents).where(eq(syncEvents.eventId, event.eventId));
    expect(ev?.status).toBe("done");
    expect(await processOne(h.db, deps)).toBe("idle");

    const audits = await h.db.select().from(auditLog);
    expect(audits.map((a) => a.action)).toContain("create");
  });

  it("editing the invoice updates QBO (with the current amount) and never duplicates", async () => {
    const { sink, events } = captureSink();
    const inv = await createInvoice(h.db, sink, { customerName: "Acme", amountCents: 1000 });
    await enqueueInternalEvent(h.db, first(events));
    await processOne(h.db, deps);
    const qboId = fake.byDoc.get(inv.id);

    await updateInvoice(h.db, sink, inv.id, { amountCents: 2000 });
    await enqueueInternalEvent(h.db, events[1] as ChangeEvent);
    await processOne(h.db, deps);

    expect(fake.createCalls).toBe(1); // still one QBO invoice
    expect(fake.updateCalls).toBe(1); // the edit was actually applied
    expect(lineAmount(fake.lastUpdate)).toBe(20); // $20.00 == 2000 cents
    expect(qboId && fake.byId.get(qboId)?.SyncToken).toBe("1");
    const link = await getLinkByInternalId(h.db, "invoice", inv.id);
    expect(link?.lastInternalVersion).toBe(2);
    // the QBO version we wrote is recorded — the reverse direction echoes on it
    expect(link?.lastQboVersion).toBe(1);
  });

  it("re-delivery of an unchanged invoice is short-circuited (no QBO call)", async () => {
    const { sink, events } = captureSink();
    const inv = await createInvoice(h.db, sink, { customerName: "Acme", amountCents: 1000 });
    await enqueueInternalEvent(h.db, first(events));
    await processOne(h.db, deps);
    expect(fake.createCalls).toBe(1);

    // a fresh event id for the same, unchanged invoice (e.g. a reconciler re-enqueue)
    const redelivery: ChangeEvent = {
      eventId: "internal:redeliver:1",
      entity: "invoice",
      entityId: inv.id,
      changeType: "update",
      version: 1,
      occurredAt: new Date().toISOString(),
    };
    expect(await enqueueInternalEvent(h.db, redelivery)).toBe("enqueued");
    await processOne(h.db, deps);

    expect(fake.createCalls).toBe(1);
    expect(fake.updateCalls).toBe(0); // nothing pushed to QBO
    const audits = await h.db.select().from(auditLog);
    expect(audits.map((a) => a.action)).toContain("skip");
  });

  it("timeout-after-write: an existing QBO invoice with no link is adopted and updated, not duplicated (money shot)", async () => {
    const { sink, events } = captureSink();
    const inv = await createInvoice(h.db, sink, { customerName: "Acme", amountCents: 5000 });
    const seededId = fake.seed(inv.id); // QBO already has it; our link write was lost

    await enqueueInternalEvent(h.db, first(events));
    await processOne(h.db, deps);

    expect(fake.createCalls).toBe(0); // adopted, no new create
    expect(fake.updateCalls).toBe(1); // reflected current state onto the existing one
    expect(fake.byId.get(seededId)?.SyncToken).toBe("1");
    const link = await getLinkByInternalId(h.db, "invoice", inv.id);
    expect(link?.qboId).toBe(seededId);
  });

  it("internal delete → voids the linked QBO invoice with its current SyncToken", async () => {
    const { sink, events } = captureSink();
    const inv = await createInvoice(h.db, sink, { customerName: "Acme", amountCents: 1000 });
    await enqueueInternalEvent(h.db, first(events));
    await processOne(h.db, deps);
    const qboId = fake.byDoc.get(inv.id);
    expect(qboId).toBeDefined();

    await deleteInvoice(h.db, sink, inv.id);
    await enqueueInternalEvent(h.db, events[1] as ChangeEvent);
    await processOne(h.db, deps);

    expect(qboId && fake.byId.get(qboId)?.voided).toBe(true);
    expect(fake.lastVoidSyncToken).toBe("0");
    const audits = await h.db.select().from(auditLog);
    expect(audits.map((a) => a.action)).toContain("void");
  });

  it("a failing event audits the error, retries with backoff, then dead-letters at max attempts", async () => {
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
    // first retry waits the base backoff (1s), not 2s
    expect(ev?.nextAttemptAt.getTime()).toBe(t0.getTime() + 1000);

    const later: WorkerDeps = { ...failing, now: () => new Date(t0.getTime() + 60_000) };
    await processOne(h.db, later);
    [ev] = await h.db.select().from(syncEvents).where(eq(syncEvents.eventId, event.eventId));
    expect(ev?.status).toBe("dead");
    expect(ev?.attempts).toBe(2);

    // failures are auditable, not just the final dead-letter
    const errors = await h.db.select().from(auditLog).where(eq(auditLog.result, "error"));
    expect(errors.length).toBe(2);
  });

  it("reclaims a stale `processing` lease left by a crashed worker", async () => {
    const { sink, events } = captureSink();
    await createInvoice(h.db, sink, { customerName: "Acme", amountCents: 1000 });
    const event = first(events);
    await enqueueInternalEvent(h.db, event);

    // simulate a crash: the row was claimed (processing) long ago and never finished
    const stale = new Date(Date.now() - 5 * 60_000);
    await h.db
      .update(syncEvents)
      .set({ status: "processing", lockedAt: stale, lockedBy: "dead-worker", attempts: 1 })
      .where(eq(syncEvents.eventId, event.eventId));

    expect(await processOne(h.db, deps)).toBe("processed");
    const [ev] = await h.db.select().from(syncEvents).where(eq(syncEvents.eventId, event.eventId));
    expect(ev?.status).toBe("done");
    expect(fake.createCalls).toBe(1);
  });

  it("ingest verifies the HMAC signature, rejects bad json/sig, and enqueues idempotently", async () => {
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

    const badSig = await app.inject({
      method: "POST",
      url: "/webhooks/internal",
      headers: { "content-type": "application/json", "x-lb-signature": "sha256=deadbeef" },
      payload: body,
    });
    expect(badSig.statusCode).toBe(401);

    // a valid signature over a malformed (non-event) body is a 400, not a 500
    const junk = "not json";
    const junkOk = await app.inject({
      method: "POST",
      url: "/webhooks/internal",
      headers: { "content-type": "application/json", "x-lb-signature": signPayload(junk, secret) },
      payload: junk,
    });
    expect(junkOk.statusCode).toBe(400);
    await app.close();
  });
});
