import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { syncEvents } from "../../db/schema";
import type { Database } from "../../db/types";

// The QBO Change Data Capture webhook (the subset we consume). Intuit batches
// changes per realm; each entity carries its id, the operation, and lastUpdated.
const qboWebhookSchema = z.object({
  eventNotifications: z.array(
    z.object({
      realmId: z.string(),
      dataChangeEvent: z.object({
        entities: z.array(
          z.object({
            name: z.string(),
            id: z.string(),
            operation: z.string(),
            lastUpdated: z.string(),
          }),
        ),
      }),
    }),
  ),
});

export type QboEntityChange = {
  qboId: string;
  lastUpdated: string;
  operation: string;
  realmId: string;
};

// Intuit signs the raw request body with the app's Verifier Token (HMAC-SHA256,
// base64-encoded) in the `intuit-signature` header.
export function verifyQboSignature(body: string, header: string, verifierToken: string): boolean {
  const expected = createHmac("sha256", verifierToken).update(body).digest("base64");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Enqueue idempotently. The event id folds in lastUpdated so a re-delivered
// notification for the same change is dropped by the UNIQUE constraint, while a
// genuinely newer change for the same invoice gets its own row.
export async function enqueueQboEvent(
  db: Database,
  change: QboEntityChange,
): Promise<"enqueued" | "duplicate"> {
  const eventId = `qbo:invoice:${change.qboId}:${change.lastUpdated}`;
  const inserted = await db
    .insert(syncEvents)
    .values({
      eventId,
      source: "quickbooks",
      entityType: "invoice",
      entityExternalId: change.qboId,
      payload: change,
      correlationId: eventId,
    })
    .onConflictDoNothing({ target: syncEvents.eventId })
    .returning({ id: syncEvents.id });
  return inserted.length > 0 ? "enqueued" : "duplicate";
}

// POST /webhooks/qbo — verify Intuit's signature over the raw body, then enqueue an
// event per changed Invoice. Registered in an encapsulated plugin so the raw-body
// parser is scoped to this route.
export function registerQboWebhook(
  app: FastifyInstance,
  deps: { db: Database; verifierToken: string },
): void {
  void app.register(async (scoped) => {
    scoped.addContentTypeParser(
      "application/json",
      { parseAs: "string" },
      (_req, body, done) => done(null, body),
    );

    scoped.post("/webhooks/qbo", async (req, reply) => {
      const raw = typeof req.body === "string" ? req.body : "";
      const sig = req.headers["intuit-signature"];
      if (typeof sig !== "string" || !verifyQboSignature(raw, sig, deps.verifierToken)) {
        return reply.code(401).send({ error: "invalid signature" });
      }

      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        return reply.code(400).send({ error: "invalid json body" });
      }

      const parsed = qboWebhookSchema.safeParse(json);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      let enqueued = 0;
      for (const note of parsed.data.eventNotifications) {
        for (const ent of note.dataChangeEvent.entities) {
          if (ent.name !== "Invoice") continue; // only invoices sync in this direction (M5)
          const result = await enqueueQboEvent(deps.db, {
            qboId: ent.id,
            lastUpdated: ent.lastUpdated,
            operation: ent.operation,
            realmId: note.realmId,
          });
          if (result === "enqueued") enqueued += 1;
        }
      }
      return reply.code(202).send({ status: "ok", enqueued });
    });
  });
}
