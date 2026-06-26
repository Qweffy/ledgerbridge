import { config } from "dotenv";
import type { QboConfig } from "./config";

config({ path: ".env.local" });

// Imports are dynamic so the env is loaded before db/index reads DATABASE_URL.
const { db } = await import("../db");
const { buildServer } = await import("./server");
const { loadQboConfig } = await import("./config");
const { createWebhookSink, noopSink } = await import("./internal/sink");
const { getInvoice, getPayment, listInvoices, updateInvoice, deleteInvoice } = await import("./internal/service");
const { createQboInvoiceOps, createQboPaymentOps } = await import("./bridge/qbo-ops");
const { startWorker } = await import("./bridge/worker");
const { startReconciler } = await import("./bridge/reconcile");

const PORT = Number(process.env.PORT ?? 3001);

// The internal system emits signed webhooks to the bridge when a target is set.
const internalSecret = process.env.INTERNAL_WEBHOOK_SECRET;
const target = process.env.INTERNAL_WEBHOOK_TARGET;
const sink =
  target && internalSecret
    ? createWebhookSink({ url: target, secret: internalSecret })
    : noopSink;

let qbo: { cfg: QboConfig } | undefined;
try {
  qbo = { cfg: loadQboConfig() };
} catch (err) {
  console.warn(
    "QBO config not loaded; OAuth routes disabled:",
    (err as Error).message,
  );
}

const qboVerifierToken = process.env.QBO_WEBHOOK_VERIFIER_TOKEN;

const app = buildServer({
  db,
  sink,
  qbo,
  bridge: internalSecret ? { secret: internalSecret, qboVerifierToken } : undefined,
});

// Start the sync worker when QBO + a connected realm + default refs are configured.
const realmId = process.env.QBO_REALM_ID;
const customerRef = process.env.QBO_DEFAULT_CUSTOMER;
const itemRef = process.env.QBO_DEFAULT_ITEM;
let worker: { stop: () => Promise<void> } | undefined;
let reconciler: { stop: () => Promise<void> } | undefined;
if (qbo && realmId && customerRef && itemRef) {
  const ops = createQboInvoiceOps({ db, cfg: qbo.cfg, realmId });
  const paymentOps = createQboPaymentOps({ db, cfg: qbo.cfg, realmId });
  worker = startWorker(db, {
    processor: {
      refetchInternalInvoice: (id) => getInvoice(db, id),
      qbo: ops,
      defaults: { customerRef, itemRef },
      // Reverse direction: write QBO-sourced changes back into the internal system.
      // These calls emit internal webhooks; the echo is dropped by hash on the way back.
      applyToInternal: {
        updateAmount: (id, amountCents) => updateInvoice(db, sink, id, { amountCents }),
        remove: (id) => deleteInvoice(db, sink, id),
      },
      // Payment sync: internal payment → QBO Payment linked to the invoice.
      payments: {
        refetchPayment: (id) => getPayment(db, id),
        qboPayments: paymentOps,
        defaults: { customerRef },
      },
    },
    pollIntervalMs: 1000,
    onError: (err) => app.log.error(err),
  });
  app.log.info("sync worker started");

  // Periodic safety net: match unlinked invoices + recover drift from dropped webhooks.
  reconciler = startReconciler(db, {
    qbo: ops,
    refetchInternal: (id) => getInvoice(db, id),
    listInternalInvoices: () => listInvoices(db),
    realmId,
    onError: (err) => app.log.error(err),
  });
  app.log.info("reconciler started");
} else {
  app.log.warn("sync worker not started (missing QBO realm/defaults)");
}

async function shutdown(): Promise<void> {
  app.log.info("shutting down");
  await reconciler?.stop();
  await worker?.stop();
  await app.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
