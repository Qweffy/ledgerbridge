import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../../db/types";
import type { QboConfig } from "../config";
import { buildAuthorizeUrl, exchangeCode } from "./intuit";
import { saveTokens } from "./store";

export interface OAuthRouteDeps {
  db: Database;
  cfg: QboConfig;
  fetchImpl?: typeof fetch;
  // The single realm this deployment may connect. When set, the callback rejects a
  // realmId that doesn't match, so tokens can't be filed under an attacker-chosen realm
  // (the signed state carries no realm binding of its own).
  expectedRealmId?: string;
}

const callbackQuery = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  realmId: z.string().min(1).optional(),
  error: z.string().optional(),
});

const STATE_TTL_MS = 10 * 60 * 1000;

// CSRF state, signed and stateless: `${nonce}.${exp}.${hmac}`. Being stateless,
// it survives a server restart (the in-memory alternative did not) and an
// attacker can't forge one without the secret.
function signState(secret: string): string {
  const nonce = randomBytes(16).toString("hex");
  const exp = Date.now() + STATE_TTL_MS;
  const payload = `${nonce}.${exp}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function verifyState(state: string, secret: string): boolean {
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [nonce, expStr, sig] = parts;
  if (!nonce || !expStr || !sig) return false;
  const expected = createHmac("sha256", secret).update(`${nonce}.${expStr}`).digest("hex");
  if (sig.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const exp = Number(expStr);
  return Number.isFinite(exp) && exp > Date.now();
}

// The QBO OAuth2 authorization-code flow:
//   /oauth/connect  → redirect the user to Intuit's consent screen (with a signed
//                     `state` to defend against CSRF).
//   /oauth/callback → Intuit redirects back with code + realmId; we verify the
//                     state, exchange the code for tokens, and store them.
export function registerOAuthRoutes(app: FastifyInstance, deps: OAuthRouteDeps): void {
  const fetchImpl = deps.fetchImpl ?? fetch;
  // Domain-separated signing key for the CSRF state, derived from the client
  // secret so the raw credential isn't reused directly across trust boundaries.
  const stateKey = createHmac("sha256", deps.cfg.clientSecret)
    .update("ledgerbridge:oauth-state")
    .digest("hex");

  app.get("/oauth/connect", async (_req, reply) => {
    return reply.redirect(buildAuthorizeUrl(deps.cfg, signState(stateKey)));
  });

  app.get("/oauth/callback", async (req, reply) => {
    const parsed = callbackQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const query = parsed.data;
    if (query.error) return reply.code(400).send({ error: query.error });
    if (!query.code || !query.state || !query.realmId) {
      return reply.code(400).send({ error: "missing code, state or realmId" });
    }
    if (!verifyState(query.state, stateKey)) {
      return reply.code(400).send({ error: "invalid or expired state" });
    }
    if (deps.expectedRealmId && query.realmId !== deps.expectedRealmId) {
      return reply.code(400).send({ error: "unexpected realmId" });
    }

    const tokens = await exchangeCode(deps.cfg, query.code, fetchImpl);
    await saveTokens(deps.db, query.realmId, tokens);
    return reply.send({ connected: true, realmId: query.realmId });
  });
}
