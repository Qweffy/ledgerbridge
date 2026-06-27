import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditLog } from "../../db/schema";
import { createTestDb, type TestDb } from "../helpers/db";
import { createFakeQbo } from "../helpers/fake-qbo";
import {
  createInvoice,
  getInvoice,
  updateInvoice,
  deleteInvoice,
} from "../../src/internal/service";
import type { ChangeEvent, ChangeSink } from "../../src/internal/sink";
import { noopSink } from "../../src/internal/sink";
import { enqueueInternalEvent } from "../../src/bridge/ingest";
import { enqueueQboEvent } from "../../src/bridge/qbo-ingest";
import { getLinkByInternalId } from "../../src/bridge/links";
import { processOne, type WorkerDeps } from "../../src/bridge/worker";
import { buildServer } from "../../src/server";

function captureSink(): { sink: ChangeSink; events: ChangeEvent[] } {
  const events: ChangeEvent[] = [];
  return { sink: { emit: async (e) => void events.push(e) }, events };
}

function actions(rows: { action: string }[]): string[] {
  return rows.map((r) => r.action);
}

describe("bridge — QBO → internal reverse sync + loop prevention", () => {
  let h: TestDb;
  let fake: ReturnType<typeof createFakeQbo>;
  let sink: ChangeSink;
  let events: ChangeEvent[];
  let deps: WorkerDeps;

  beforeEach(async () => {
    h = await createTestDb();
    fake = createFakeQbo();
    const cap = captureSink();
    sink = cap.sink;
    events = cap.events;
    deps = {
      workerId: "test",
      processor: {
        refetchInternalInvoice: (id) => getInvoice(h.db, id),
        qbo: fake.ops,
        defaults: { customerRef: "1", itemRef: "1" },
        applyToInternal: {
          updateAmount: (id, amountCents) => updateInvoice(h.db, sink, id, { amountCents }),
          remove: (id) => deleteInvoice(h.db, sink, id),
        },
      },
    };
  });
  afterEach(async () => {
    await h.close();
  });

  // Create an internal invoice and sync it once (internal → QBO), so a link exists
  // with the QBO version we wrote recorded on it. Returns the new QBO id.
  async function syncNewInvoice(amountCents: number): Promise<{ id: string; qboId: string }> {
    const inv = await createInvoice(h.db, sink, { customerName: "Acme", amountCents });
    const created = events[events.length - 1];
    if (!created) throw new Error("expected a create event");
    await enqueueInternalEvent(h.db, created);
    await processOne(h.db, deps);
    const qboId = fake.byDoc.get(inv.id);
    if (!qboId) throw new Error("expected a QBO id after first sync");
    return { id: inv.id, qboId };
  }

  it("an edit made in QBO propagates to internal, and the internal echo it triggers is dropped (flow #3)", async () => {
    const { id, qboId } = await syncNewInvoice(10000);

    // Someone edits the invoice directly in QBO → its version moves past ours.
    fake.externalEdit(qboId, { totalCents: 25000 });
    expect(await enqueueQboEvent(h.db, { qboId, lastUpdated: "2026-06-26T10:00:00Z", operation: "Update", realmId: "r1" })).toBe("enqueued");
    await processOne(h.db, deps);

    // It was applied to the internal invoice (refetched, not trusted from a payload).
    const internal = await getInvoice(h.db, id);
    expect(internal?.amountCents).toBe(25000);
    const link = await getLinkByInternalId(h.db, "invoice", id);
    expect(link?.lastQboVersion).toBe(1);
    expect(actions(await h.db.select().from(auditLog))).toContain("update");

    // The internal write above emitted a webhook. Re-process it (internal → QBO):
    // the hash matches, so it's short-circuited — no write back to QBO, no loop.
    const echo = events[events.length - 1];
    if (!echo) throw new Error("expected an internal echo event");
    await enqueueInternalEvent(h.db, echo);
    await processOne(h.db, deps);
    expect(fake.createCalls).toBe(1); // still the original create
    expect(fake.updateCalls).toBe(0); // nothing pushed back to QBO
    const skips = (await h.db.select().from(auditLog)).filter((a) => a.action === "skip");
    expect(skips.some((s) => s.error?.includes("unchanged"))).toBe(true);
  });

  it("our own write-back is recognised as an echo and dropped (no internal change)", async () => {
    const { id, qboId } = await syncNewInvoice(10000);
    const before = await getInvoice(h.db, id);
    const eventsBefore = events.length;

    // QBO fires a webhook for the invoice WE just created — same version we recorded.
    await enqueueQboEvent(h.db, { qboId, lastUpdated: "2026-06-26T09:00:00Z", operation: "Create", realmId: "r1" });
    await processOne(h.db, deps);

    const after = await getInvoice(h.db, id);
    expect(after?.version).toBe(before?.version); // untouched
    expect(after?.amountCents).toBe(before?.amountCents);
    expect(events.length).toBe(eventsBefore); // no internal write emitted
    const skips = (await h.db.select().from(auditLog)).filter((a) => a.action === "skip");
    expect(skips.some((s) => s.error?.includes("echo"))).toBe(true);
  });

  it("an invoice voided in QBO is deleted internally, and we don't void it back", async () => {
    const { id, qboId } = await syncNewInvoice(10000);

    fake.externalEdit(qboId, { voided: true });
    await enqueueQboEvent(h.db, { qboId, lastUpdated: "2026-06-26T11:00:00Z", operation: "Update", realmId: "r1" });
    await processOne(h.db, deps);

    const internal = await getInvoice(h.db, id);
    expect(internal?.status).toBe("deleted");
    expect(actions(await h.db.select().from(auditLog))).toContain("void");

    // The internal delete echoes back; the hash short-circuit drops it — we never
    // call QBO void (which would have been a redundant re-void).
    const echo = events[events.length - 1];
    if (!echo) throw new Error("expected an internal echo event");
    await enqueueInternalEvent(h.db, echo);
    await processOne(h.db, deps);
    expect(fake.lastVoidSyncToken).toBeUndefined();
  });

  it("a QBO change with no link of ours is skipped for the reconciler, not misapplied", async () => {
    const qboId = fake.seed("UNKNOWN-1"); // exists in QBO, but we never linked it
    fake.externalEdit(qboId, { totalCents: 5000 });
    await enqueueQboEvent(h.db, { qboId, lastUpdated: "2026-06-26T12:00:00Z", operation: "Update", realmId: "r1" });
    await processOne(h.db, deps);

    const skips = (await h.db.select().from(auditLog)).filter((a) => a.action === "skip");
    expect(skips.some((s) => s.error?.includes("no link"))).toBe(true);
  });

  it("a re-delivered (out-of-order) QBO webhook for an already-applied change is dropped — no double-apply", async () => {
    const { id, qboId } = await syncNewInvoice(10000);

    fake.externalEdit(qboId, { totalCents: 25000 });
    await enqueueQboEvent(h.db, { qboId, lastUpdated: "2026-06-26T10:00:00Z", operation: "Update", realmId: "r1" });
    await processOne(h.db, deps);
    const applied = await getInvoice(h.db, id);
    expect(applied?.amountCents).toBe(25000);

    // The same change is delivered again (duplicate / out-of-order). Refetch sees the
    // current SyncToken == the version we recorded → echo/stale, dropped. No re-apply.
    await enqueueQboEvent(h.db, { qboId, lastUpdated: "2026-06-26T10:05:00Z", operation: "Update", realmId: "r1" });
    await processOne(h.db, deps);
    const again = await getInvoice(h.db, id);
    expect(again?.amountCents).toBe(25000);
    expect(again?.version).toBe(applied?.version); // not bumped a second time
    const skips = (await h.db.select().from(auditLog)).filter((a) => a.action === "skip");
    expect(skips.some((s) => s.error?.includes("echo"))).toBe(true);
  });
});

describe("bridge — QBO webhook ingest", () => {
  let h: TestDb;
  beforeEach(async () => {
    h = await createTestDb();
  });
  afterEach(async () => {
    await h.close();
  });

  function signQbo(body: string, token: string): string {
    return createHmac("sha256", token).update(body).digest("base64");
  }

  it("verifies Intuit's signature, parses the CDC payload, and enqueues idempotently", async () => {
    const token = "verifier-token";
    const app = buildServer({ db: h.db, sink: noopSink, bridge: { secret: "s", qboVerifierToken: token } });

    const payload = {
      eventNotifications: [
        {
          realmId: "r1",
          dataChangeEvent: {
            entities: [
              { name: "Invoice", id: "101", operation: "Update", lastUpdated: "2026-06-26T10:00:00Z" },
              { name: "Customer", id: "9", operation: "Update", lastUpdated: "2026-06-26T10:00:00Z" },
            ],
          },
        },
      ],
    };
    const body = JSON.stringify(payload);
    const headers = { "content-type": "application/json", "intuit-signature": signQbo(body, token) };

    const ok = await app.inject({ method: "POST", url: "/webhooks/qbo", headers, payload: body });
    expect(ok.statusCode).toBe(202);
    expect(ok.json()).toMatchObject({ status: "ok", enqueued: 1 }); // only the Invoice, not the Customer

    // Re-delivery of the same notification enqueues nothing (UNIQUE event id).
    const dup = await app.inject({ method: "POST", url: "/webhooks/qbo", headers, payload: body });
    expect(dup.json()).toMatchObject({ enqueued: 0 });

    const badSig = await app.inject({
      method: "POST",
      url: "/webhooks/qbo",
      headers: { "content-type": "application/json", "intuit-signature": signQbo(body, "wrong-token") },
      payload: body,
    });
    expect(badSig.statusCode).toBe(401);

    await app.close();
  });
});
