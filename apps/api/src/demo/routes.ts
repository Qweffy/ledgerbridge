import type { FastifyInstance } from "fastify";
import type { Database } from "../../db/types";
import type { ChangeSink } from "../internal/sink";
import { createInvoice, getInvoice, updateInvoice } from "../internal/service";
import { listLinks, type LinkRow } from "../bridge/links";
import { mapInvoiceToQbo, type QboInvoiceDefaults } from "../bridge/mapping";
import { reconcileOnce, type ReconcileDeps } from "../bridge/reconcile";
import type { QboInvoiceOps } from "../bridge/qbo-ops";

// A one-shot fault budget shared with the worker's processor (its faultInjector
// closes over this). While remaining > 0, the processor throws before each outbound
// QBO write, so the next event(s) exhaust their retries and dead-letter.
export interface FaultBox {
  remaining: number;
}

export interface DemoDeps {
  db: Database;
  sink: ChangeSink;
  // Present only when QBO is configured; without it only create-invoice works and
  // the rest return 503 (mirrors the observability resolve gate).
  qbo?: {
    invoiceOps: QboInvoiceOps;
    defaults: QboInvoiceDefaults;
    reconcile: ReconcileDeps;
    faultBox: FaultBox;
    maxAttempts: number;
  };
}

const DEMO_CUSTOMERS = ["Northwind Traders", "Globex Corp", "Initech", "Vandelay Industries", "Pied Piper LLC", "Hooli", "Soylent Corp"];

function randomInvoice(): { customerName: string; amountCents: number } {
  const customerName = DEMO_CUSTOMERS[Math.floor(Math.random() * DEMO_CUSTOMERS.length)] ?? "Acme";
  const amountCents = 50_000 + Math.floor(Math.random() * 250_000); // $500 – $3,000
  return { customerName, amountCents };
}

async function findLinkedInvoice(db: Database): Promise<LinkRow | undefined> {
  const rows = await listLinks(db, "invoice", "linked");
  return rows
    .filter((l) => l.internalId && l.qboId)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
}

// The /demo/* control surface — thin wrappers that drive the real engine so a
// reviewer can trigger live activity from the dashboard. Reads/writes the same
// internal service + bridge + reconciler the worker uses; nothing is mocked.
export function registerDemoRoutes(app: FastifyInstance, demo: DemoDeps): void {
  const { db, sink } = demo;

  // Emit a fresh internal invoice into the pipeline; the running worker syncs it to
  // QBO. Internal-only, so it works even without QBO configured.
  app.post("/demo/create-invoice", async (_req, reply) => {
    const inv = await createInvoice(db, sink, randomInvoice());
    return reply.code(201).send({ ok: true, invoiceId: inv.id, docNumber: inv.docNumber });
  });

  app.post("/demo/reconcile", async (_req, reply) => {
    if (!demo.qbo) return reply.code(503).send({ error: "reconcile unavailable (QBO not configured)" });
    const summary = await reconcileOnce(db, demo.qbo.reconcile);
    return { ok: true, ...summary };
  });

  // Edit the same invoice on both sides so the next worker pass detects a both-changed
  // conflict (not a one-sided apply): bump the internal amount and the QBO amount to
  // two different values, both diverging from the last-synced basis.
  app.post("/demo/edit-both", async (_req, reply) => {
    if (!demo.qbo) return reply.code(503).send({ error: "edit-both unavailable (QBO not configured)" });
    const link = await findLinkedInvoice(db);
    if (!link || !link.internalId || !link.qboId) {
      return reply.code(409).send({ error: "no synced invoice yet — run Create invoice and let it sync first" });
    }
    const inv = await getInvoice(db, link.internalId);
    if (!inv) return reply.code(409).send({ error: "linked invoice no longer present" });

    const base = link.lastSyncedSnapshot?.amountCents ?? inv.amountCents;
    const internalAmount = base + 5_000;
    const qboAmount = base + 9_000;
    await updateInvoice(db, sink, inv.id, { amountCents: internalAmount });
    const qboState = await demo.qbo.invoiceOps.read(link.qboId);
    const qboBody = mapInvoiceToQbo({ ...inv, amountCents: qboAmount }, demo.qbo.defaults);
    await demo.qbo.invoiceOps.update({ ...qboBody, Id: qboState.Id, SyncToken: qboState.SyncToken });
    return { ok: true, linkId: link.id, internalAmountCents: internalAmount, qboAmountCents: qboAmount };
  });

  // Arm a one-shot fault budget and emit a guaranteed victim invoice, so its outbound
  // QBO writes fail every attempt and the event dead-letters — visible on Events.
  app.post("/demo/inject-fault", async (_req, reply) => {
    if (!demo.qbo) return reply.code(503).send({ error: "inject-fault unavailable (QBO not configured)" });
    demo.qbo.faultBox.remaining = demo.qbo.maxAttempts;
    const inv = await createInvoice(db, sink, randomInvoice());
    return { ok: true, invoiceId: inv.id };
  });
}
