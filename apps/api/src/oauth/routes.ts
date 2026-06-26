import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Database } from "../../db/types";
import type { QboConfig } from "../config";
import { buildAuthorizeUrl, exchangeCode } from "./intuit";
import { saveTokens } from "./store";

export interface OAuthRouteDeps {
  db: Database;
  cfg: QboConfig;
  fetchImpl?: typeof fetch;
}

// The QBO OAuth2 authorization-code flow:
//   /oauth/connect  → redirect the user to Intuit's consent screen (with a
//                     single-use `state` we remember to defend against CSRF).
//   /oauth/callback → Intuit redirects back with code + realmId; we validate the
//                     state, exchange the code for tokens, and store them.
export function registerOAuthRoutes(app: FastifyInstance, deps: OAuthRouteDeps): void {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const STATE_TTL_MS = 10 * 60 * 1000;
  const states = new Map<string, number>();

  app.get("/oauth/connect", async (_req, reply) => {
    const state = randomBytes(16).toString("hex");
    states.set(state, Date.now() + STATE_TTL_MS);
    return reply.redirect(buildAuthorizeUrl(deps.cfg, state));
  });

  app.get("/oauth/callback", async (req, reply) => {
    const query = req.query as {
      code?: string;
      state?: string;
      realmId?: string;
      error?: string;
    };
    if (query.error) return reply.code(400).send({ error: query.error });
    if (!query.code || !query.state || !query.realmId) {
      return reply.code(400).send({ error: "missing code, state or realmId" });
    }
    const expiry = states.get(query.state);
    if (!expiry || expiry < Date.now()) {
      return reply.code(400).send({ error: "invalid or expired state" });
    }
    states.delete(query.state);

    const tokens = await exchangeCode(deps.cfg, query.code, fetchImpl);
    await saveTokens(deps.db, query.realmId, tokens);
    return reply.send({ connected: true, realmId: query.realmId });
  });
}
