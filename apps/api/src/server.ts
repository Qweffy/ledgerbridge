import Fastify, { type FastifyInstance } from "fastify";
import type { Database } from "../db/types";
import type { QboConfig } from "./config";
import type { ChangeSink } from "./internal/sink";
import { registerInternalRoutes } from "./internal/routes";
import { registerOAuthRoutes } from "./oauth/routes";
import { registerBridgeIngest } from "./bridge/ingest";
import { registerQboWebhook } from "./bridge/qbo-ingest";
import { registerObservabilityRoutes } from "./observability/routes";
import type { ResolveDeps } from "./bridge/resolve";

export interface ServerDeps {
  db: Database;
  sink: ChangeSink;
  qbo?: { cfg: QboConfig; fetchImpl?: typeof fetch };
  bridge?: { secret: string; qboVerifierToken?: string };
  // Conflict resolution for the observability API. Present only when QBO is wired.
  resolve?: ResolveDeps;
}

// buildServer is pure — it takes its dependencies, so tests can inject a
// PGlite-backed db, a capturing sink, and a mocked fetch without touching a real
// database or Intuit.
export function buildServer(deps?: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok" as const }));

  if (deps) {
    registerInternalRoutes(app, deps);
    if (deps.qbo) {
      registerOAuthRoutes(app, {
        db: deps.db,
        cfg: deps.qbo.cfg,
        fetchImpl: deps.qbo.fetchImpl,
      });
    }
    if (deps.bridge) {
      registerBridgeIngest(app, { db: deps.db, secret: deps.bridge.secret });
      if (deps.bridge.qboVerifierToken) {
        registerQboWebhook(app, { db: deps.db, verifierToken: deps.bridge.qboVerifierToken });
      }
    }
    registerObservabilityRoutes(app, { db: deps.db, resolve: deps.resolve });
  }

  return app;
}
