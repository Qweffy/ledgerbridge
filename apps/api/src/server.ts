import Fastify, { type FastifyInstance } from "fastify";
import type { Database } from "../db/types";
import type { ChangeSink } from "./internal/sink";
import { registerInternalRoutes } from "./internal/routes";

export interface ServerDeps {
  db: Database;
  sink: ChangeSink;
}

// buildServer is pure — it takes its dependencies, so tests can inject a
// PGlite-backed db and a capturing sink without touching a real database.
export function buildServer(deps?: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok" as const }));

  if (deps) {
    registerInternalRoutes(app, deps);
  }

  return app;
}
