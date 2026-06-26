import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db";
import {
  createInvoice,
  deleteInvoice,
  getInvoice,
  recordPayment,
  updateInvoice,
} from "../../src/internal/service";
import {
  createWebhookSink,
  signPayload,
  type ChangeEvent,
  type ChangeSink,
} from "../../src/internal/sink";

function captureSink(): { sink: ChangeSink; events: ChangeEvent[] } {
  const events: ChangeEvent[] = [];
  return { sink: { emit: async (e) => void events.push(e) }, events };
}

describe("internal system — change feed + signed webhooks", () => {
  let h: TestDb;

  beforeEach(async () => {
    h = await createTestDb();
  });
  afterEach(async () => {
    await h.close();
  });

  it("create / edit / pay / delete each emit exactly one change", async () => {
    const { sink, events } = captureSink();

    const inv = await createInvoice(h.db, sink, { customerName: "Acme", amountCents: 12480 });
    expect(inv.status).toBe("open");
    expect(inv.balanceCents).toBe(12480);

    const edited = await updateInvoice(h.db, sink, inv.id, { customerName: "Acme Corp" });
    expect(edited.customerName).toBe("Acme Corp");

    const { invoice: paid } = await recordPayment(h.db, sink, inv.id, 5000);
    expect(paid.balanceCents).toBe(7480);
    expect(paid.status).toBe("partially_paid");

    const deleted = await deleteInvoice(h.db, sink, inv.id);
    expect(deleted.status).toBe("deleted");
    expect(deleted.deletedAt).not.toBeNull();

    // one signed event per change, stable unique ids. The payment is its own entity
    // (it syncs to a QBO Payment), so the "pay" change targets the payment, not the invoice.
    expect(events.map((e) => e.changeType)).toEqual(["create", "update", "pay", "delete"]);
    expect(events.map((e) => e.entity)).toEqual(["invoice", "invoice", "payment", "invoice"]);
    expect(events[2]?.entityId).toMatch(/^PAY-/);
    expect([events[0], events[1], events[3]].every((e) => e?.entityId === inv.id)).toBe(true);
    // the invoice's own versions stay monotonic across create → update → delete
    expect([events[0]?.version, events[1]?.version, events[3]?.version]).toEqual([1, 2, 4]);
    expect(new Set(events.map((e) => e.eventId)).size).toBe(4);

    // refetch returns current state (the bridge never trusts the payload)
    const refetched = await getInvoice(h.db, inv.id);
    expect(refetched?.status).toBe("deleted");
    expect(refetched?.version).toBe(4);
  });

  it("paying the full balance marks the invoice paid", async () => {
    const { sink } = captureSink();
    const inv = await createInvoice(h.db, sink, { customerName: "Beta", amountCents: 1000 });
    const { invoice } = await recordPayment(h.db, sink, inv.id, 1000);
    expect(invoice.balanceCents).toBe(0);
    expect(invoice.status).toBe("paid");
  });

  it("the webhook sink signs the body with HMAC-SHA256", async () => {
    const calls: Array<{ url: string; body: string; sig: string }> = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url: String(url), body: String(init?.body), sig: headers["x-lb-signature"] ?? "" });
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    const sink = createWebhookSink({
      url: "http://bridge/webhooks/internal",
      secret: "s3cr3t",
      fetchImpl: fakeFetch,
    });
    await sink.emit({
      eventId: "internal:change:1",
      entity: "invoice",
      entityId: "INV-1",
      changeType: "create",
      version: 1,
      occurredAt: "2026-06-26T00:00:00.000Z",
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.sig).toBe(signPayload(call?.body ?? "", "s3cr3t"));
    expect(call?.sig.startsWith("sha256=")).toBe(true);
  });
});
