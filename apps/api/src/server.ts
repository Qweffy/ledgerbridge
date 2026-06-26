import Fastify, { type FastifyInstance } from "fastify";
import type { Database } from "../db/types";
import type { QboConfig } from "./config";
import type { ChangeSink } from "./internal/sink";
import { registerInternalRoutes } from "./internal/routes";
import { registerOAuthRoutes } from "./oauth/routes";

export interface ServerDeps {
  db: Database;
  sink: ChangeSink;
  qbo?: { cfg: QboConfig; fetchImpl?: typeof fetch };
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
  }

  return app;
}
