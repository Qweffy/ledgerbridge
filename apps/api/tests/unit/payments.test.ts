import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditLog, syncEvents } from "../../db/schema";
import { createTestDb, type TestDb } from "../helpers/db";
import { createFakeQbo } from "../helpers/fake-qbo";
import { createInvoice, getInvoice, getPayment, recordPayment } from "../../src/internal/service";
import type { ChangeEvent, ChangeSink } from "../../src/internal/sink";
import { enqueueInternalEvent } from "../../src/bridge/ingest";
import { getLinkByInternalId } from "../../src/bridge/links";
import { processOne, type WorkerDeps } from "../../src/bridge/worker";

function captureSink(): { sink: ChangeSink; events: ChangeEvent[] } {
  const events: ChangeEvent[] = [];
  return { sink: { emit: async (e) => void events.push(e) }, events };
}

// Reach into a QBO Payment body's first line LinkedTxn (the invoice it pays).
function linkedTxnId(body: Record<string, unknown> | undefined): string | undefined {
  const line = (body?.Line as Array<{ LinkedTxn?: Array<{ TxnId?: string }> }> | undefined)?.[0];
  return line?.LinkedTxn?.[0]?.TxnId;
}

describe("bridge — payment sync (internal → QBO Payment)", () => {
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
        payments: {
          refetchPayment: (id) => getPayment(h.db, id),
          qboPayments: fake.payments,
          defaults: { customerRef: "1" },
        },
      },
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

  it("a partial payment creates one QBO Payment linked to the invoice; re-delivery is idempotent", async () => {
    const { id, qboId } = await syncNewInvoice(10000);

    const { invoice, payment } = await recordPayment(h.db, sink, id, 4000);
    expect(invoice.balanceCents).toBe(6000); // recomputed from source
    expect(invoice.status).toBe("partially_paid");

    await enqueueInternalEvent(h.db, lastEvent()); // the payment-typed change event
    expect(await processOne(h.db, deps)).toBe("processed");

    expect(fake.paymentCreateCalls).toBe(1);
    expect(fake.lastPaymentBody?.TotalAmt).toBe(40); // $40.00 == 4000 cents
    expect(linkedTxnId(fake.lastPaymentBody)).toBe(qboId); // linked to the invoice
    const link = await getLinkByInternalId(h.db, "payment", payment.id);
    expect(link?.qboId).toBeDefined();
    expect(link?.status).toBe("linked");

    // a re-delivery (fresh event id, same payment) does not create a second Payment
    const redelivery: ChangeEvent = {
      eventId: "internal:redeliver:pay",
      entity: "payment",
      entityId: payment.id,
      changeType: "pay",
      version: 1,
      occurredAt: new Date().toISOString(),
    };
    expect(await enqueueInternalEvent(h.db, redelivery)).toBe("enqueued");
    await processOne(h.db, deps);
    expect(fake.paymentCreateCalls).toBe(1); // still one
    const skips = (await h.db.select().from(auditLog)).filter((a) => a.error?.includes("already synced"));
    expect(skips.length).toBe(1);
  });

  it("paying the full balance marks the invoice paid and syncs the payment", async () => {
    const { id } = await syncNewInvoice(10000);
    const { invoice } = await recordPayment(h.db, sink, id, 10000);
    expect(invoice.balanceCents).toBe(0);
    expect(invoice.status).toBe("paid");

    await enqueueInternalEvent(h.db, lastEvent());
    await processOne(h.db, deps);

    expect(fake.paymentCreateCalls).toBe(1);
    expect(fake.lastPaymentBody?.TotalAmt).toBe(100);
  });

  it("a payment whose invoice isn't synced yet retries, then succeeds once the invoice links", async () => {
    // create the invoice but DON'T sync it (no link yet)
    const inv = await createInvoice(h.db, sink, { customerName: "Acme", amountCents: 10000 });
    const createEvent = lastEvent();
    const { payment } = await recordPayment(h.db, sink, inv.id, 4000);
    const payEvent = lastEvent();

    // process the payment first → it can't link, so it errors and is retried
    await enqueueInternalEvent(h.db, payEvent);
    await processOne(h.db, deps);
    let [ev] = await h.db.select().from(syncEvents).where(eq(syncEvents.eventId, payEvent.eventId));
    expect(ev?.status).toBe("pending");
    expect(ev?.lastError).toContain("not yet linked");
    expect(fake.paymentCreateCalls).toBe(0);

    // now sync the invoice, then re-run the payment past its backoff window
    await enqueueInternalEvent(h.db, createEvent);
    await processOne(h.db, deps); // claims the invoice create → link exists
    await processOne(h.db, { ...deps, now: () => new Date(Date.now() + 10_000) });

    expect(fake.paymentCreateCalls).toBe(1);
    expect((await getLinkByInternalId(h.db, "payment", payment.id))?.qboId).toBeDefined();
    [ev] = await h.db.select().from(syncEvents).where(eq(syncEvents.eventId, payEvent.eventId));
    expect(ev?.status).toBe("done");
  });
});
