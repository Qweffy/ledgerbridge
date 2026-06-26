import { db } from "../db";
import { buildServer } from "./server";
import { createWebhookSink, noopSink, type ChangeSink } from "./internal/sink";

const PORT = Number(process.env.PORT ?? 3001);

// The internal system emits to the bridge once that endpoint exists (M4). Until
// INTERNAL_WEBHOOK_TARGET is set, mutations still record changes but don't emit.
const target = process.env.INTERNAL_WEBHOOK_TARGET;
const secret = process.env.INTERNAL_WEBHOOK_SECRET;
const sink: ChangeSink =
  target && secret ? createWebhookSink({ url: target, secret }) : noopSink;

async function start(): Promise<void> {
  const app = buildServer({ db, sink });
  try {
    await app.listen({ port: PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();
