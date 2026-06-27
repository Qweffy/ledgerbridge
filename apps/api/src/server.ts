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
import { makeAdminGuard } from "./auth";
import { registerHttpTracing } from "./telemetry";
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
    allowedHeaders: ["content-type", "authorization"],
  });

  // One OpenTelemetry span per request (no-op until OTEL_ENABLED registers a provider).
  registerHttpTracing(app);

  app.get("/health", async () => ({ status: "ok" as const }));

  if (deps) {
    // Public, self-authenticating routes: the OAuth redirect/callback and the
    // HMAC-verified webhook receivers. These must stay reachable without a bearer token.
    if (deps.qbo) {
      registerOAuthRoutes(app, {
        db: deps.db,
        cfg: deps.qbo.cfg,
        fetchImpl: deps.qbo.fetchImpl,
        // Single-tenant: tokens may only be filed under the configured realm.
        expectedRealmId: process.env.QBO_REALM_ID,
      });
    }
    if (deps.bridge) {
      registerBridgeIngest(app, { db: deps.db, secret: deps.bridge.secret });
      if (deps.bridge.qboVerifierToken) {
        registerQboWebhook(app, { db: deps.db, verifierToken: deps.bridge.qboVerifierToken });
      }
    }

    // The admin surface (internal API + observability + demo control) in one
    // encapsulated scope, optionally gated by ADMIN_API_TOKEN — a no-op when unset
    // so the sandbox demo stays open (CORS + the OAuth/webhook routes are inherited
    // from the parent, so they're unaffected).
    const adminGuard = makeAdminGuard();
    void app.register(async (admin) => {
      if (adminGuard) admin.addHook("onRequest", adminGuard);
      registerInternalRoutes(admin, deps);
      registerObservabilityRoutes(admin, { db: deps.db, resolve: deps.resolve });
      if (deps.demo) registerDemoRoutes(admin, deps.demo);
    });
  }

  return app;
}
