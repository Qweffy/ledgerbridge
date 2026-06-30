import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { syncEvents } from "../../db/schema";
import type { Database } from "../../db/types";

// The signed webhook the internal system emits (mirrors internal/sink.ts).
export const changeEventSchema = z.object({
  eventId: z.string().min(1),
  entity: z.enum(["invoice", "payment", "account"]),
  // Constrained at the boundary so an id can be safely used as a QBO DocNumber in
  // a query (no injection) — rejected with 400 otherwise.
  entityId: z.string().regex(/^[A-Za-z0-9:_-]+$/),
  changeType: z.enum(["create", "update", "pay", "delete"]),
  version: z.number().int(),
  occurredAt: z.string(),
});
export type ChangeEvent = z.infer<typeof changeEventSchema>;

// Enqueue idempotently: the UNIQUE event_id means a re-delivered webhook hits the
// conflict and inserts nothing.
export async function enqueueInternalEvent(
  db: Database,
  event: ChangeEvent,
): Promise<"enqueued" | "duplicate"> {
  const inserted = await db
    .insert(syncEvents)
    .values({
      eventId: event.eventId,
      source: "internal",
      entityType: event.entity,
      entityExternalId: event.entityId,
      payload: event,
      correlationId: event.eventId,
    })
    .onConflictDoNothing({ target: syncEvents.eventId })
    .returning({ id: syncEvents.id });
  return inserted.length > 0 ? "enqueued" : "duplicate";
}

export function verifySignature(body: string, header: string, secret: string): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  if (header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

// POST /webhooks/internal — verify the HMAC signature over the raw body, then
// enqueue. Registered in an encapsulated plugin so the raw-body parser only
// affects this route.
export function registerBridgeIngest(
  app: FastifyInstance,
  deps: { db: Database; secret: string },
): void {
  void app.register(async (scoped) => {
    scoped.addContentTypeParser(
      "application/json",
      { parseAs: "string" },
      (_req, body, done) => done(null, body),
    );

    scoped.post("/webhooks/internal", async (req, reply) => {
      const raw = typeof req.body === "string" ? req.body : "";
      const sig = req.headers["x-lb-signature"];
      if (typeof sig !== "string" || !verifySignature(raw, sig, deps.secret)) {
        return reply.code(401).send({ error: "invalid signature" });
      }

      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        return reply.code(400).send({ error: "invalid json body" });
      }

      const parsed = changeEventSchema.safeParse(json);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const result = await enqueueInternalEvent(deps.db, parsed.data);
      return reply.code(202).send({ status: result });
    });
  });
}
