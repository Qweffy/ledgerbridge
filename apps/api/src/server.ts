import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { Database } from "../db/types";
import type { QboConfig } from "./config";
import type { ChangeSink } from "./internal/sink";
import { registerInternalRoutes } from "./internal/routes";
import { registerOAuthRoutes } from "./oauth/routes";
import { registerBridgeIngest } from "./bridge/ingest";
import { registerQboWebhook } from "./bridge/qbo-ingest";
import { registerObservabilityRoutes } from "./observability/routes";
import { registerDemoRoutes, type DemoDeps } from "./demo/routes";
import type { ResolveDeps } from "./bridge/resolve";

export interface ServerDeps {
  db: Database;
  sink: ChangeSink;
  qbo?: { cfg: QboConfig; fetchImpl?: typeof fetch };
  bridge?: { secret: string; qboVerifierToken?: string };
  // Conflict resolution for the observability API. Present only when QBO is wired.
  resolve?: ResolveDeps;
  // The /demo/* control surface. Present whenever the server has a db + sink.
  demo?: DemoDeps;
}

// buildServer is pure — it takes its dependencies, so tests can inject a
// PGlite-backed db, a capturing sink, and a mocked fetch without touching a real
// database or Intuit.
export function buildServer(deps?: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: true });

  // The dashboard fetches cross-origin (web :3000 → api :3001). Origin is
  // env-driven so deploy (Vercel domain) needs no code change; comma-separate for
  // multiple. The client sends content-type on every request, so GETs preflight too.
  void app.register(cors, {
    origin: (process.env.WEB_ORIGIN ?? "http://localhost:3000").split(","),
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type"],
  });

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
    if (deps.demo) registerDemoRoutes(app, deps.demo);
  }

  return app;
}
