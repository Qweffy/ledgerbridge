import { config } from "dotenv";
import type { QboConfig } from "./config";

config({ path: ".env.local" });

// Imports are dynamic so the env is loaded before db/index reads DATABASE_URL.
const { db } = await import("../db");
const { buildServer } = await import("./server");
const { loadQboConfig } = await import("./config");
const { createWebhookSink, noopSink } = await import("./internal/sink");

const PORT = Number(process.env.PORT ?? 3001);

// The internal system emits to the bridge once that endpoint exists (M4). Until
// INTERNAL_WEBHOOK_TARGET is set, mutations still record changes but don't emit.
const target = process.env.INTERNAL_WEBHOOK_TARGET;
const secret = process.env.INTERNAL_WEBHOOK_SECRET;
const sink =
  target && secret ? createWebhookSink({ url: target, secret }) : noopSink;

let qbo: { cfg: QboConfig } | undefined;
try {
  qbo = { cfg: loadQboConfig() };
} catch (err) {
  console.warn(
    "QBO config not loaded; OAuth routes disabled:",
    (err as Error).message,
  );
}

const app = buildServer({ db, sink, qbo });
try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
