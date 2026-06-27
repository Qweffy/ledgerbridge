import { timingSafeEqual } from "node:crypto";
import type { onRequestHookHandler } from "fastify";

// A bearer-token gate for the admin surface (internal API, observability, demo). The
// compare is constant-time so the token can't be recovered byte-by-byte via timing.
export function bearerGuard(token: string): onRequestHookHandler {
  const expected = Buffer.from(`Bearer ${token}`);
  return async (req, reply) => {
    const header = req.headers.authorization;
    const got = Buffer.from(typeof header === "string" ? header : "");
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  };
}

// Opt-in admin auth: with ADMIN_API_TOKEN set, every admin/internal/demo route requires
// the bearer token; unset (the sandbox default) it returns undefined so those routes
// stay open and the public demo is drivable. The enforcement seam exists either way.
export function makeAdminGuard(): onRequestHookHandler | undefined {
  const token = process.env.ADMIN_API_TOKEN;
  return token ? bearerGuard(token) : undefined;
}
