import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db";
import { deriveUnpooledUrl } from "../../src/bridge/notify";
import { enqueueInternalEvent } from "../../src/bridge/ingest";
import { startWorker } from "../../src/bridge/worker";
import type { ProcessorDeps } from "../../src/bridge/processor";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("deriveUnpooledUrl", () => {
  it("strips the Neon -pooler segment so the listener gets a session connection", () => {
    expect(deriveUnpooledUrl("postgresql://u:p@ep-cool-1-pooler.us-east-2.aws.neon.tech/db")).toBe(
      "postgresql://u:p@ep-cool-1.us-east-2.aws.neon.tech/db",
    );
  });
  it("leaves a non-pooled URL unchanged", () => {
    const url = "postgresql://u:p@ep-cool-1.us-east-2.aws.neon.tech/db";
    expect(deriveUnpooledUrl(url)).toBe(url);
  });
});

describe("sync_events NOTIFY trigger", () => {
  let h: TestDb;
  beforeEach(async () => {
    h = await createTestDb();
  });
  afterEach(async () => {
    await h.close();
  });

  it("fires a notification when an event is enqueued (so the worker can wake instantly)", async () => {
    let notified = 0;
    await h.client.listen("sync_events", () => {
      notified += 1;
    });
    await enqueueInternalEvent(h.db, {
      eventId: "internal:change:1",
      entity: "invoice",
      entityId: "INV-1",
      changeType: "create",
      version: 1,
      occurredAt: new Date("2026-06-27T00:00:00Z").toISOString(),
    });
    await sleep(120);
    expect(notified).toBeGreaterThan(0);
  });
});

describe("startWorker wake", () => {
  let h: TestDb;
  beforeEach(async () => {
    h = await createTestDb();
  });
  afterEach(async () => {
    await h.close();
  });

  it("processes again on wake() instead of waiting out the poll interval", async () => {
    let ticks = 0;
    const worker = startWorker(h.db, {
      // No events are enqueued, so the processor is never invoked; the empty outbox
      // makes every processOne return "idle". `now` is called once per pass — a cheap
      // way to count passes.
      processor: {} as unknown as ProcessorDeps,
      pollIntervalMs: 5000,
      now: () => {
        ticks += 1;
        return new Date();
      },
    });
    await sleep(150); // first pass runs, then the worker enters its idle wait
    const before = ticks;
    expect(before).toBeGreaterThanOrEqual(1);

    worker.wake(); // cut the 5s idle short
    await sleep(150);
    expect(ticks).toBeGreaterThan(before);

    await worker.stop();
  });
});
