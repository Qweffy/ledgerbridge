import type { FastifyInstance } from "fastify";
import {
  dashboardSourceSchema,
  entityTypeSchema,
  eventStatusSchema,
  linkStatusSchema,
  resolveRequestSchema,
  sourceToSystemId,
} from "@ledgerbridge/shared";
import { z } from "zod";
import type { Database } from "../../db/types";
import { ResolveError, resolveConflict, type ResolveDeps } from "../bridge/resolve";
import {
  getConflict,
  getEvent,
  getLink,
  getStatus,
  listAudit,
  listConflicts,
  listEvents,
  listLinks,
  replayEvent,
} from "./queries";

export interface ObservabilityDeps {
  db: Database;
  // resolveConflict needs QBO — present only when QBO is configured.
  resolve?: ResolveDeps;
}

const idParam = z.object({ id: z.string().regex(/^\d+$/) });
const limit = z.coerce.number().int().positive().max(500).optional();
const eventsQuery = z.object({
  status: eventStatusSchema.optional(),
  source: dashboardSourceSchema.optional(),
  entityType: entityTypeSchema.optional(),
  limit,
});
const linksQuery = z.object({
  status: linkStatusSchema.optional(),
  entityType: entityTypeSchema.optional(),
  limit,
});
const auditQuery = z.object({ limit });

// The admin/observability API the dashboard reads (and acts on). Reads are pure DB;
// conflict-resolve needs QBO, so it's gated. No auth (sandbox — a bearer token is the
// production follow-up).
export function registerObservabilityRoutes(app: FastifyInstance, deps: ObservabilityDeps): void {
  const { db } = deps;

  app.get("/status", async () => getStatus(db));

  app.get("/events", async (req, reply) => {
    const q = eventsQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: q.error.flatten() });
    return listEvents(db, q.data);
  });

  app.get("/events/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const event = await getEvent(db, Number(id));
    if (!event) return reply.code(404).send({ error: "not found" });
    return event;
  });

  app.post("/events/:id/replay", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const result = await replayEvent(db, Number(id), new Date());
    if (result === "not_found") return reply.code(404).send({ error: "not found" });
    if (result === "processing") return reply.code(409).send({ error: "event is processing" });
    return { id, status: "pending" as const, replayed: true as const };
  });

  app.get("/links", async (req, reply) => {
    const q = linksQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: q.error.flatten() });
    return listLinks(db, q.data);
  });

  app.get("/links/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const link = await getLink(db, Number(id));
    if (!link) return reply.code(404).send({ error: "not found" });
    return link;
  });

  app.get("/conflicts", async () => listConflicts(db));

  app.get("/conflicts/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const conflict = await getConflict(db, Number(id));
    if (!conflict) return reply.code(404).send({ error: "not found" });
    return conflict;
  });

  app.post("/conflicts/:id/resolve", async (req, reply) => {
    if (!deps.resolve) {
      return reply.code(503).send({ error: "resolve unavailable (QBO not configured)" });
    }
    const { id } = idParam.parse(req.params);
    const body = resolveRequestSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    try {
      await resolveConflict(db, Number(id), sourceToSystemId(body.data.winner), deps.resolve);
    } catch (err) {
      if (err instanceof ResolveError) {
        const code = err.message.includes("not found") ? 404 : 409;
        return reply.code(code).send({ error: err.message });
      }
      throw err;
    }
    return { id, resolved: true as const, winner: body.data.winner };
  });

  app.get("/audit", async (req, reply) => {
    const q = auditQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: q.error.flatten() });
    return listAudit(db, q.data.limit);
  });
}
