import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
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
  const secret = deps.cfg.clientSecret;

  app.get("/oauth/connect", async (_req, reply) => {
    return reply.redirect(buildAuthorizeUrl(deps.cfg, signState(secret)));
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
    if (!verifyState(query.state, secret)) {
      return reply.code(400).send({ error: "invalid or expired state" });
    }

    const tokens = await exchangeCode(deps.cfg, query.code, fetchImpl);
    await saveTokens(deps.db, query.realmId, tokens);
    return reply.send({ connected: true, realmId: query.realmId });
  });
}
