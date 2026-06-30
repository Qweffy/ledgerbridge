import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditLog } from "../../db/schema";
import { createTestDb, type TestDb } from "../helpers/db";
import { createFakeQbo } from "../helpers/fake-qbo";
import { createAccount, getAccount, getInvoice, updateAccount } from "../../src/internal/service";
import type { ChangeEvent, ChangeSink } from "../../src/internal/sink";
import { enqueueInternalEvent } from "../../src/bridge/ingest";
import { getLinkByInternalId } from "../../src/bridge/links";
import { processOne, type WorkerDeps } from "../../src/bridge/worker";

function captureSink(): { sink: ChangeSink; events: ChangeEvent[] } {
  const events: ChangeEvent[] = [];
  return { sink: { emit: async (e) => void events.push(e) }, events };
}

describe("bridge — account sync (internal GL account → QBO Account)", () => {
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
        accounts: {
          refetchAccount: (id) => getAccount(h.db, id),
          qboAccounts: fake.accounts,
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

  it("creates one QBO Account with the mapped Name/Type and links it; re-delivery is idempotent", async () => {
    const acct = await createAccount(h.db, sink, { name: "Consulting Income", acctType: "Income" });

    await enqueueInternalEvent(h.db, lastEvent());
    expect(await processOne(h.db, deps)).toBe("processed");

    expect(fake.accountCreateCalls).toBe(1);
    expect(fake.lastAccountBody?.Name).toBe("Consulting Income");
    expect(fake.lastAccountBody?.AccountType).toBe("Income");
    const link = await getLinkByInternalId(h.db, "account", acct.id);
    expect(link?.qboId).toBeDefined();
    expect(link?.status).toBe("linked");

    // a re-delivery (fresh event id, same unchanged account) does not create a second Account
    const redelivery: ChangeEvent = {
      eventId: "internal:redeliver:acct",
      entity: "account",
      entityId: acct.id,
      changeType: "create",
      version: 1,
      occurredAt: new Date().toISOString(),
    };
    expect(await enqueueInternalEvent(h.db, redelivery)).toBe("enqueued");
    await processOne(h.db, deps);
    expect(fake.accountCreateCalls).toBe(1); // still one
    const skips = (await h.db.select().from(auditLog)).filter((a) => a.error?.includes("unchanged since last sync"));
    expect(skips.length).toBe(1);
  });

  it("adopts a QBO Account that already exists by Name (write landed, link lost) instead of duplicating", async () => {
    // QBO already has the account (a prior create that timed out after landing), but we have no link.
    const seededId = fake.seedAccount("Rent Expense");

    const acct = await createAccount(h.db, sink, { name: "Rent Expense", acctType: "Expense" });
    await enqueueInternalEvent(h.db, lastEvent());
    await processOne(h.db, deps);

    expect(fake.accountCreateCalls).toBe(0); // adopted, not created
    expect(fake.accountUpdateCalls).toBe(1);
    const link = await getLinkByInternalId(h.db, "account", acct.id);
    expect(link?.qboId).toBe(seededId); // linked to the pre-existing QBO account
    expect(link?.status).toBe("linked");
  });

  it("an account rename syncs as a QBO update on the same account", async () => {
    const acct = await createAccount(h.db, sink, { name: "Old Name", acctType: "Income" });
    await enqueueInternalEvent(h.db, lastEvent());
    await processOne(h.db, deps);
    const qboId = (await getLinkByInternalId(h.db, "account", acct.id))?.qboId;
    expect(fake.accountCreateCalls).toBe(1);

    await updateAccount(h.db, sink, acct.id, { name: "New Name" });
    await enqueueInternalEvent(h.db, lastEvent());
    await processOne(h.db, deps);

    expect(fake.accountCreateCalls).toBe(1); // no second create
    expect(fake.accountUpdateCalls).toBe(1);
    expect(fake.lastAccountBody?.Name).toBe("New Name");
    const link = await getLinkByInternalId(h.db, "account", acct.id);
    expect(link?.qboId).toBe(qboId); // same QBO account
    expect(link?.status).toBe("linked");
  });
});
