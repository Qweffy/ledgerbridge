import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditLog, links } from "../../db/schema";
import { createTestDb, type TestDb } from "../helpers/db";
import { createFakeQbo } from "../helpers/fake-qbo";
import {
  createInvoice,
  getInvoice,
  updateInvoice,
  deleteInvoice,
} from "../../src/internal/service";
import type { ChangeEvent, ChangeSink } from "../../src/internal/sink";
import { enqueueInternalEvent } from "../../src/bridge/ingest";
import { enqueueQboEvent } from "../../src/bridge/qbo-ingest";
import { getLinkByInternalId } from "../../src/bridge/links";
import { processOne, type WorkerDeps } from "../../src/bridge/worker";
import { resolveConflict, type ResolveDeps } from "../../src/bridge/resolve";
import { analyze, actionFor, type InvoiceCanonical } from "../../src/bridge/conflict";

function captureSink(): { sink: ChangeSink; events: ChangeEvent[] } {
  const events: ChangeEvent[] = [];
  return { sink: { emit: async (e) => void events.push(e) }, events };
}

function actions(rows: { action: string }[]): string[] {
  return rows.map((r) => r.action);
}

describe("bridge — conflict detection + resolution", () => {
  let h: TestDb;
  let fake: ReturnType<typeof createFakeQbo>;
  let sink: ChangeSink;
  let events: ChangeEvent[];
  let deps: WorkerDeps;
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

  // Both sides edit the amount before either syncs → a same-field conflict. Flag it
  // by processing the internal event (which now sees QBO has also moved).
  async function setupConflict(): Promise<{ id: string; qboId: string; linkId: number }> {
    const { id, qboId } = await syncNewInvoice(10000);
    await updateInvoice(h.db, sink, id, { amountCents: 20000 });
    await enqueueInternalEvent(h.db, lastEvent());
    fake.externalEdit(qboId, { totalCents: 30000 });
    await enqueueQboEvent(h.db, { qboId, lastUpdated: "2026-06-26T10:00:00Z", operation: "Update", realmId: "r1" });
    await processOne(h.db, deps); // claims the internal edit (older) → flags conflict
    const link = await getLinkByInternalId(h.db, "invoice", id);
    if (!link) throw new Error("expected a link");
    return { id, qboId, linkId: link.id };
  }

  it("flow #4 — both edit the amount differently → conflict flagged, neither side clobbered", async () => {
    const { id, qboId, linkId } = await setupConflict();

    const link = await getLinkByInternalId(h.db, "invoice", id);
    expect(link?.status).toBe("conflict");
    expect(link?.id).toBe(linkId);
    expect(fake.updateCalls).toBe(0); // QBO not written
    expect(fake.byId.get(qboId)?.totalCents).toBe(30000); // QBO edit intact
    expect((await getInvoice(h.db, id))?.amountCents).toBe(20000); // internal edit intact
    expect(actions(await h.db.select().from(auditLog))).toContain("conflict");
  });

  it("holds further events on a conflicted link instead of clobbering", async () => {
    const { id } = await setupConflict();

    // a new internal edit arrives while the conflict is unresolved
    await updateInvoice(h.db, sink, id, { amountCents: 25000 });
    await enqueueInternalEvent(h.db, lastEvent());
    await processOne(h.db, deps);

    expect(fake.updateCalls).toBe(0); // still nothing pushed to QBO
    expect((await getLinkByInternalId(h.db, "invoice", id))?.status).toBe("conflict");
    const held = (await h.db.select().from(auditLog)).filter((a) => a.error?.includes("held"));
    expect(held.length).toBeGreaterThan(0);
  });

  it("resolve(internal) → QBO takes internal's amount, link clears to linked", async () => {
    const { id, qboId, linkId } = await setupConflict();
    await resolveConflict(h.db, linkId, "internal", resolveDeps);

    expect(fake.byId.get(qboId)?.totalCents).toBe(20000); // internal's value won
    const link = await getLinkByInternalId(h.db, "invoice", id);
    expect(link?.status).toBe("linked");
    expect(link?.lastSyncedSnapshot?.amountCents).toBe(20000);
    expect(actions(await h.db.select().from(auditLog))).toContain("conflict_resolved");
  });

  it("resolve(qbo) → internal takes QBO's amount, link clears to linked", async () => {
    const { id, linkId } = await setupConflict();
    await resolveConflict(h.db, linkId, "quickbooks", resolveDeps);

    expect((await getInvoice(h.db, id))?.amountCents).toBe(30000); // QBO's value won
    const link = await getLinkByInternalId(h.db, "invoice", id);
    expect(link?.status).toBe("linked");
    expect(link?.lastSyncedSnapshot?.amountCents).toBe(30000);
  });

  it("flow #5 — internal edits a non-synced field while QBO edits the amount → no false conflict", async () => {
    const { id, qboId } = await syncNewInvoice(10000);

    // internal touches only customerName (not a synced field); QBO moves the amount
    await updateInvoice(h.db, sink, id, { customerName: "New Corp" });
    await enqueueInternalEvent(h.db, lastEvent());
    fake.externalEdit(qboId, { totalCents: 25000 });
    await enqueueQboEvent(h.db, { qboId, lastUpdated: "2026-06-26T11:00:00Z", operation: "Update", realmId: "r1" });

    await processOne(h.db, deps); // internal event: no syncable change → don't clobber QBO
    await processOne(h.db, deps); // QBO event: apply the amount to internal

    const link = await getLinkByInternalId(h.db, "invoice", id);
    expect(link?.status).toBe("linked"); // never flagged
    expect(fake.updateCalls).toBe(0); // internal's customerName edit didn't push to QBO
    expect(fake.byId.get(qboId)?.totalCents).toBe(25000); // QBO edit preserved
    const internal = await getInvoice(h.db, id);
    expect(internal?.amountCents).toBe(25000); // QBO's amount applied to internal
    expect(internal?.customerName).toBe("New Corp"); // internal's edit preserved
    expect(actions(await h.db.select().from(auditLog))).not.toContain("conflict");
  });

  it("both edit the amount to the SAME value → converged, not a conflict", async () => {
    const { id, qboId } = await syncNewInvoice(10000);
    await updateInvoice(h.db, sink, id, { amountCents: 20000 });
    await enqueueInternalEvent(h.db, lastEvent());
    fake.externalEdit(qboId, { totalCents: 20000 });
    await enqueueQboEvent(h.db, { qboId, lastUpdated: "2026-06-26T12:00:00Z", operation: "Update", realmId: "r1" });

    await processOne(h.db, deps); // internal event sees QBO already at the same value

    const link = await getLinkByInternalId(h.db, "invoice", id);
    expect(link?.status).toBe("linked");
    expect(link?.lastSyncedSnapshot?.amountCents).toBe(20000);
    expect(fake.updateCalls).toBe(0);
    expect(actions(await h.db.select().from(auditLog))).not.toContain("conflict");
  });

  it("a pre-M6 link (no snapshot) applies normally — no false conflict on first event", async () => {
    const { id, qboId } = await syncNewInvoice(10000);
    // simulate a legacy link with no basis recorded
    const link = await getLinkByInternalId(h.db, "invoice", id);
    if (!link) throw new Error("expected a link");
    await h.db.update(links).set({ lastSyncedSnapshot: null }).where(eq(links.id, link.id));

    await updateInvoice(h.db, sink, id, { amountCents: 20000 });
    await enqueueInternalEvent(h.db, lastEvent());
    fake.externalEdit(qboId, { totalCents: 30000 });

    await processOne(h.db, deps); // no basis → apply, don't false-conflict

    expect((await getLinkByInternalId(h.db, "invoice", id))?.status).toBe("linked");
    expect(fake.updateCalls).toBe(1); // applied normally
    expect(actions(await h.db.select().from(auditLog))).not.toContain("conflict");
  });
});

describe("conflict — pure analysis", () => {
  const snap: InvoiceCanonical = { amountCents: 10000, status: "open" };
  const c = (amountCents: number): InvoiceCanonical => ({ amountCents, status: "open" });

  it("classifies the outcome from the snapshot deltas", () => {
    expect(analyze(null, c(20000), c(30000)).outcome).toBe("no-basis");
    expect(analyze(snap, c(10000), c(10000)).outcome).toBe("neither");
    expect(analyze(snap, c(20000), c(10000)).outcome).toBe("internal-only");
    expect(analyze(snap, c(10000), c(20000)).outcome).toBe("qbo-only");
    expect(analyze(snap, c(20000), c(20000)).outcome).toBe("converged");
    expect(analyze(snap, c(20000), c(30000)).outcome).toBe("conflict");
  });

  it("maps an outcome to the right action per direction", () => {
    expect(actionFor("internal", analyze(snap, c(20000), c(30000)))).toBe("conflict");
    expect(actionFor("internal", analyze(snap, c(20000), c(10000)))).toBe("apply");
    expect(actionFor("internal", analyze(snap, c(10000), c(20000)))).toBe("skip");
    expect(actionFor("quickbooks", analyze(snap, c(10000), c(20000)))).toBe("apply");
    expect(actionFor("quickbooks", analyze(snap, c(20000), c(10000)))).toBe("skip");
    expect(actionFor("internal", analyze(snap, c(20000), c(20000)))).toBe("converged");
  });
});
