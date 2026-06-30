import { config } from "dotenv";
import type { FastifyInstance } from "fastify";
import type { QboConfig } from "./config";
import type { ResolveDeps } from "./bridge/resolve";
import type { ReconcileDeps } from "./bridge/reconcile";
import type { DemoDeps, FaultBox } from "./demo/routes";

config({ path: ".env.local" });

// Start tracing before anything else so spans have a provider (no-op unless OTEL_ENABLED).
const { startTelemetry } = await import("./telemetry");
await startTelemetry();

// Imports are dynamic so the env is loaded before db/index reads DATABASE_URL.
const { db } = await import("../db");
const { buildServer } = await import("./server");
const { loadQboConfig } = await import("./config");
const { createWebhookSink, noopSink } = await import("./internal/sink");
const { getInvoice, getPayment, getAccount, listInvoices, updateInvoice, deleteInvoice } = await import("./internal/service");
const { createQboInvoiceOps, createQboPaymentOps, createQboAccountOps } = await import("./bridge/qbo-ops");
const { startWorker, DEFAULT_MAX_ATTEMPTS } = await import("./bridge/worker");
const { startReconciler } = await import("./bridge/reconcile");
const { startNotifyListener, deriveUnpooledUrl } = await import("./bridge/notify");

const PORT = Number(process.env.PORT ?? 3001);

// The internal system emits signed webhooks to the bridge when a target is set.
const internalSecret = process.env.INTERNAL_WEBHOOK_SECRET;
const target = process.env.INTERNAL_WEBHOOK_TARGET;
const sink =
  target && internalSecret
    ? createWebhookSink({ url: target, secret: internalSecret })
    : noopSink;

// The /demo/* control surface — create-invoice is internal-only (always available);
// the QBO-touching actions are wired below only when QBO is configured.
const demoDeps: DemoDeps = { db, sink };

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

// Build the QBO-dependent deps (sync ops + conflict resolution) once, before the
// server, so the observability API's /conflicts/:id/resolve can reuse them. They only
// exist when QBO + a connected realm + default refs are configured.
const realmId = process.env.QBO_REALM_ID;
const customerRef = process.env.QBO_DEFAULT_CUSTOMER;
const itemRef = process.env.QBO_DEFAULT_ITEM;

let resolveDeps: ResolveDeps | undefined;
let worker: { stop: () => Promise<void>; wake: () => void } | undefined;
let reconciler: { stop: () => Promise<void> } | undefined;
let notifyListener: { stop: () => Promise<void> } | undefined;
let startBackground: ((app: FastifyInstance) => void) | undefined;

if (qbo && realmId && customerRef && itemRef) {
  const ops = createQboInvoiceOps({ db, cfg: qbo.cfg, realmId });
  const paymentOps = createQboPaymentOps({ db, cfg: qbo.cfg, realmId });
  const accountOps = createQboAccountOps({ db, cfg: qbo.cfg, realmId });
  // Reverse direction: write QBO-sourced changes back into the internal system. These
  // calls emit internal webhooks; the echo is dropped by hash on the way back.
  const applyToInternal = {
    updateAmount: (id: string, amountCents: number) => updateInvoice(db, sink, id, { amountCents }),
    remove: (id: string) => deleteInvoice(db, sink, id),
  };
  resolveDeps = {
    qbo: ops,
    internal: applyToInternal,
    refetchInternal: (id) => getInvoice(db, id),
    defaults: { customerRef, itemRef },
  };
  // Shared by the background reconciler and the /demo/reconcile endpoint.
  const reconcileDeps: ReconcileDeps = {
    qbo: ops,
    refetchInternal: (id) => getInvoice(db, id),
    listInternalInvoices: () => listInvoices(db),
    realmId,
  };
  // One-shot fault budget the demo arms; the worker's processor drains it.
  const faultBox: FaultBox = { remaining: 0 };
  demoDeps.qbo = {
    invoiceOps: ops,
    defaults: { customerRef, itemRef },
    reconcile: reconcileDeps,
    faultBox,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
  };
  startBackground = (app) => {
    worker = startWorker(db, {
      processor: {
        refetchInternalInvoice: (id) => getInvoice(db, id),
        qbo: ops,
        defaults: { customerRef, itemRef },
        applyToInternal,
        // Payment sync: internal payment → QBO Payment linked to the invoice.
        payments: {
          refetchPayment: (id) => getPayment(db, id),
          qboPayments: paymentOps,
          defaults: { customerRef },
        },
        // Account sync: internal GL account → QBO Account (chart of accounts).
        accounts: {
          refetchAccount: (id) => getAccount(db, id),
          qboAccounts: accountOps,
        },
        // Demo: throw before an outbound QBO write while the fault budget is armed.
        faultInjector: () => {
          if (faultBox.remaining > 0) {
            faultBox.remaining -= 1;
            throw new Error("injected fault (demo)");
          }
        },
      },
      pollIntervalMs: 1000,
      onError: (err) => app.log.error(err),
    });
    // Periodic safety net: match unlinked invoices + recover drift from dropped webhooks.
    reconciler = startReconciler(db, { ...reconcileDeps, onError: (err) => app.log.error(err) });
    // Instant wake on enqueue (latency win over the 1s poll), best-effort: a LISTEN
    // connection that can't be established just leaves the worker polling. Neon's
    // pooled URL can't LISTEN, so use the unpooled host (explicit env or derived).
    const unpooledUrl = process.env.DATABASE_URL_UNPOOLED ?? deriveUnpooledUrl(process.env.DATABASE_URL ?? "");
    if (unpooledUrl) {
      notifyListener = startNotifyListener({
        url: unpooledUrl,
        onWake: () => worker?.wake(),
        onReady: () => app.log.info("listening for sync_events (instant wake)"),
        onError: (err) =>
          app.log.warn(
            { err: err instanceof Error ? err.message : String(err) },
            "sync_events listener error — falling back to polling",
          ),
      });
    }
    app.log.info("sync worker + reconciler started");
  };
}

const app = buildServer({
  db,
  sink,
  qbo,
  bridge: internalSecret ? { secret: internalSecret, qboVerifierToken } : undefined,
  resolve: resolveDeps,
  demo: demoDeps,
});

if (startBackground) startBackground(app);
else app.log.warn("sync worker not started (missing QBO realm/defaults)");

async function shutdown(): Promise<void> {
  app.log.info("shutting down");
  await notifyListener?.stop();
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
