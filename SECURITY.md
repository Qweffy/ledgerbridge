# Security

An independent, first-principles security review of LedgerBridge, plus the threat model and the
deliberate tradeoffs the current scope accepts. The review traced every untrusted input to the
sensitive sinks it can reach; findings and their fixes are below, each with a `file:line` anchor.

## Threat model — trust boundaries

| Surface | Reachable by | Trusted? | Control |
|---|---|---|---|
| `POST /webhooks/internal` | the internal invoicing system (public URL) | **No** | HMAC-SHA256 over the raw body, timing-safe ([ingest.ts:41](apps/api/src/bridge/ingest.ts)); zod schema; UNIQUE `event_id` dedup |
| `POST /webhooks/qbo` | Intuit (public URL) | **No** | HMAC-SHA256 verifier token, timing-safe ([qbo-ingest.ts:36](apps/api/src/bridge/qbo-ingest.ts)); zod schema; refetch-don't-trust |
| `GET /oauth/connect` · `/oauth/callback` | the browser mid-OAuth (public) | **No** | signed, expiring CSRF `state` ([oauth/routes.ts](apps/api/src/oauth/routes.ts)); realm pinned to config |
| `/internal/*`, `/demo/*`, observability (`/status`, `/events`, `/conflicts`, `/audit`, replay, resolve) | the operator dashboard | partially | zod at every boundary; **optional** bearer guard ([auth.ts](apps/api/src/auth.ts)) |
| QBO Accounting API responses | Intuit | **No** | refetched, never trusted from the webhook payload; written via Drizzle / parameterized |
| `DATABASE_URL`, `QBO_*`, `INTERNAL_WEBHOOK_SECRET`, `ADMIN_API_TOKEN` | the host env | **Yes** | never committed (`.env*` gitignored + `.dockerignore`d); entered in each platform's dashboard |

The two load-bearing ideas double as security controls: **a webhook is a ping, not the truth** (every
event triggers a refetch, so a forged or tampered payload can't drive state — the source system is
re-read), and **every write is idempotent** (replay can't duplicate records).

## Methodology

Driven by the built-in `/security-review` pass over `apps/api/src`, supplemented by a manual data-flow
trace from each untrusted input to its sinks and grounded in current best practices for the stack
(Fastify, Drizzle, Zod, OAuth2/Intuit). Each candidate was adversarially checked for a concrete attack
path before being accepted as a finding; pattern-matches with no reachable path (e.g. "raw-looking" SQL
that is actually Drizzle-parameterized) were discarded.

## Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Admin/internal/demo surface had no authentication; now publicly deployed | High | **Fixed** — optional bearer guard; open-by-design in the sandbox demo |
| 2 | OAuth callback filed tokens under the request's `realmId`, unbound to `state` | Medium | **Fixed** — realm pinned + zod-validated |
| 3 | QBO query-language literal built by string interpolation | Low (defense-in-depth) | **Fixed** — escaped |
| 4 | OAuth tokens stored plaintext at rest | Low | **Accepted** (sandbox) → roadmap |
| 5 | Token refresh has no cross-process advisory lock | Low | **Accepted** (single process) → roadmap |
| 6 | No security headers / rate limiting | Low | **Accepted** → roadmap |

### 1 — Authentication on the admin surface (High, fixed)
Every `/internal/*`, `/demo/*`, and observability route was unauthenticated. Harmless on localhost, but
the API is now deployed publicly, so the **state-mutating** ones (`/demo/*`, `/conflicts/:id/resolve`,
`/events/:id/replay`, `/internal/*`) were reachable by anonymous `curl` and would drive real QBO sandbox
writes. CORS is **not** a control here — it is browser-enforced and irrelevant to a direct server-side
request.

Fix: a single bearer-token guard ([auth.ts](apps/api/src/auth.ts)) applied to the whole admin surface via
one encapsulated scope ([server.ts](apps/api/src/server.ts)); the public OAuth + webhook routes are
registered outside it. The compare is constant-time (`crypto.timingSafeEqual`). It is **opt-in**: with
`ADMIN_API_TOKEN` set the routes require `Authorization: Bearer <token>`; unset — the sandbox default — it
is a no-op so the live demo stays drivable. This is a deliberate tradeoff (see below): the enforcement
seam exists and is tested, and is one env var away from locked down.

### 2 — OAuth realm binding (Medium, fixed)
`/oauth/callback` verified the signed CSRF `state` but then trusted `query.realmId` as the key the tokens
are stored under. Because `state` carried no realm binding, the realm a token row lands under was
controlled by the request, not by the consent that produced the `code`. Fix: the callback now rejects any
`realmId` that isn't the single configured `QBO_REALM_ID`, and parses the whole query with zod
([oauth/routes.ts](apps/api/src/oauth/routes.ts)). Test: `oauth.test.ts` — "rejects a callback whose
realmId is not the configured realm".

### 3 — QBO query-language escaping (Low / defense-in-depth, fixed)
`findByDocNumber` / `listByDocNumber` built Intuit's SQL-like query by interpolating the DocNumber into a
single-quoted literal ([qbo-ops.ts](apps/api/src/bridge/qbo-ops.ts)). Traced honestly, this was **not**
exploitable: the only values reaching it are our own generated ids (`INV-{hex}`) and the webhook
`entityId`, already constrained to `/^[A-Za-z0-9:_-]+$/` at ingest — the user-settable `docNumber` field
never reaches a query. Still, it was safe by convention, not construction. Fix: a `qboQuoteLiteral` helper
backslash-escapes `'` and `\` per Intuit's documented escaping, so no value can break out of the literal.
Test: `qbo-ops.test.ts`.

## Verified safe (examined, no change needed)
- **SQL injection.** All database access uses Drizzle's parameterized builder (`eq`/`and`/`inArray`,
  `.values()`, `.set()`) or `sql` tagged templates with bound values — no untrusted string is concatenated
  into SQL. Numeric route params are zod-checked (`/^\d+$/`) before `Number(...)`.
- **Webhook HMAC.** Both receivers verify an HMAC over the **raw** body with a length check then
  `crypto.timingSafeEqual` — constant-time, no early-exit string compare.
- **OAuth CSRF.** `state` is `nonce.exp.hmac`, signed with a key domain-separated from the client secret,
  TTL-checked, and compared timing-safe.
- **Secret / error exposure.** No secrets or tokens are logged or returned; error responses are structured
  messages (flattened zod issues, not stack traces). CORS `origin` is env-driven, not a permissive reflector.

## Deliberate tradeoffs (sandbox scope)
- **The demo runs with `ADMIN_API_TOKEN` unset**, so the admin surface is open — by choice, so reviewers
  can drive the engine end-to-end against a throwaway QBO **sandbox** company (fake data). The guard is
  built and tested; any real deployment sets the token.
- **Tokens are stored plaintext** in `oauth_tokens`. Acceptable for one sandbox realm; production encrypts
  at rest (KMS / pgcrypto / a secrets manager).
- **Single-tenant, single-process.** One realm is configured at startup and the worker/reconciler/API share
  one process, so token refresh needs no cross-process lock.

## Production hardening roadmap
- **Auth:** set `ADMIN_API_TOKEN` (or front the admin surface with a session / JWT + RBAC) — the seam is in place.
- **Headers + rate limiting:** add [`@fastify/helmet`](https://github.com/fastify/fastify-helmet) and
  `@fastify/rate-limit` (a few lines each) on the public routes.
- **Tokens:** encrypt at rest; add a Postgres advisory lock around refresh if scaling to multiple workers.
- **Multi-tenant:** key the OAuth flow and the sync state by realm end-to-end.

## References
- Intuit — [Query operations and syntax](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries) (backslash escaping of literals)
- Fastify — [@fastify/helmet](https://github.com/fastify/fastify-helmet) · security headers and the `onRequest` hook pattern
- OWASP — [ASVS](https://owasp.org/www-project-application-security-verification-standard/) and the [Top 10](https://owasp.org/www-project-top-ten/) (access control, injection, identification & auth)
