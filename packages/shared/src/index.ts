import { z } from "zod";

// The status vocabulary the UI renders (StatusBadge). Fixed and non-negotiable —
// see the design system DESIGN-SYSTEM.md.
export const SYNC_STATUSES = [
  "synced",
  "inflight",
  "queued",
  "conflict",
  "failed",
  "deadletter",
  "replayed",
  "idle",
  "skipped",
] as const;
export const syncStatusSchema = z.enum(SYNC_STATUSES);
export type SyncStatus = z.infer<typeof syncStatusSchema>;

export const SYNC_STATUS_LABEL: Readonly<Record<SyncStatus, string>> = Object.freeze({
  synced: "Synced",
  inflight: "In flight",
  queued: "Queued",
  conflict: "Conflict",
  failed: "Failed",
  deadletter: "Dead-letter",
  replayed: "Replayed",
  idle: "Idle",
  skipped: "Skipped",
});

// ---- Data-model vocabularies (also reused as Drizzle pgEnum values) ----

/** Which side of the bridge an entity or event belongs to. */
export const SYSTEM_IDS = ["internal", "quickbooks"] as const;
export const systemIdSchema = z.enum(SYSTEM_IDS);
export type SystemId = z.infer<typeof systemIdSchema>;

/** The kinds of records we map and sync. */
export const ENTITY_TYPES = ["invoice", "payment", "account"] as const;
export const entityTypeSchema = z.enum(ENTITY_TYPES);
export type EntityType = z.infer<typeof entityTypeSchema>;

/** sync_events lifecycle: queued → in flight → synced, or dead-lettered. */
export const EVENT_STATUSES = ["pending", "processing", "done", "dead"] as const;
export const eventStatusSchema = z.enum(EVENT_STATUSES);
export type EventStatus = z.infer<typeof eventStatusSchema>;

/** links lifecycle: a healthy mapping, a conflict, an error, or a skipped echo. */
export const LINK_STATUSES = ["linked", "conflict", "error", "skip"] as const;
export const linkStatusSchema = z.enum(LINK_STATUSES);
export type LinkStatus = z.infer<typeof linkStatusSchema>;

/** What an audit row records happened. */
export const AUDIT_ACTIONS = [
  "create",
  "update",
  "void",
  "delete",
  "skip",
  "conflict",
  "conflict_resolved",
  "error",
] as const;
export const auditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof auditActionSchema>;

// ---- Mappers: data-model status → the UI's StatusBadge vocabulary ----

export function eventStatusToSyncStatus(status: EventStatus): SyncStatus {
  switch (status) {
    case "pending":
      return "queued";
    case "processing":
      return "inflight";
    case "done":
      return "synced";
    case "dead":
      return "deadletter";
  }
}

export function linkStatusToSyncStatus(status: LinkStatus): SyncStatus {
  switch (status) {
    case "linked":
      return "synced";
    case "conflict":
      return "conflict";
    case "error":
      return "failed";
    case "skip":
      return "skipped";
  }
}

// ---- Dashboard source vocabulary: the UI says "qbo", the data model says "quickbooks" ----

export const DASHBOARD_SOURCES = ["internal", "qbo"] as const;
export const dashboardSourceSchema = z.enum(DASHBOARD_SOURCES);
export type DashboardSource = z.infer<typeof dashboardSourceSchema>;

export function systemIdToSource(id: SystemId): DashboardSource {
  return id === "quickbooks" ? "qbo" : "internal";
}
export function sourceToSystemId(source: DashboardSource): SystemId {
  return source === "qbo" ? "quickbooks" : "internal";
}

// ---- Observability API DTOs (the dashboard contract) ----
// Snapshots are open key→value maps: we populate only the fields our model actually
// has. Nullable fields mirror the DB (a link mid-backfill can have one side null).

const auditResultSchema = z.enum(["ok", "error"]);
const snapshotSchema = z.record(z.string());
const timelineEntrySchema = z.object({
  ts: z.string(),
  action: auditActionSchema,
  result: auditResultSchema,
  detail: z.string(),
});

export const statusDtoSchema = z.object({
  counts: z.object({
    pending: z.number(),
    processing: z.number(),
    done: z.number(),
    dead: z.number(),
  }),
  oldestPendingLagSec: z.number().nullable(),
  deadLetterCount: z.number(),
  conflictCount: z.number(),
  lastReconcileAt: z.string().nullable(),
});
export type StatusDto = z.infer<typeof statusDtoSchema>;

export const linkDtoSchema = z.object({
  id: z.string(),
  entityType: entityTypeSchema,
  internalId: z.string().nullable(),
  qboId: z.string().nullable(),
  status: linkStatusSchema,
  lastSyncedAt: z.string().nullable(),
  drift: z.boolean(),
});
export type LinkDto = z.infer<typeof linkDtoSchema>;

export const linkDetailDtoSchema = linkDtoSchema.extend({
  internalSnapshot: snapshotSchema,
  qboSnapshot: snapshotSchema,
  timeline: z.array(timelineEntrySchema),
});
export type LinkDetailDto = z.infer<typeof linkDetailDtoSchema>;

export const conflictDtoSchema = z.object({
  id: z.string(),
  linkId: z.string(),
  eventId: z.string(),
  entityType: entityTypeSchema,
  internalId: z.string().nullable(),
  customer: z.string(),
  reason: z.string(),
  openedAt: z.string().nullable(),
  conflictingFields: z.array(z.string()),
});
export type ConflictDto = z.infer<typeof conflictDtoSchema>;

export const conflictDetailDtoSchema = conflictDtoSchema.extend({
  before: snapshotSchema,
  after: snapshotSchema,
});
export type ConflictDetailDto = z.infer<typeof conflictDetailDtoSchema>;

export const eventDtoSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  source: dashboardSourceSchema,
  entityType: entityTypeSchema,
  externalId: z.string(),
  operation: z.string(),
  status: eventStatusSchema,
  attempts: z.number(),
  maxAttempts: z.number(),
  nextAttemptAt: z.string().nullable(),
  lastError: z.string().nullable(),
  receivedAt: z.string().nullable(),
  correlationId: z.string().nullable(),
});
export type EventDto = z.infer<typeof eventDtoSchema>;

export const eventDetailDtoSchema = eventDtoSchema.extend({
  payload: z.record(z.unknown()),
  auditTrail: z.array(timelineEntrySchema),
});
export type EventDetailDto = z.infer<typeof eventDetailDtoSchema>;

export const auditEntryDtoSchema = z.object({
  id: z.string(),
  eventId: z.string().nullable(),
  entityType: entityTypeSchema.nullable(),
  action: auditActionSchema,
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  result: auditResultSchema,
  error: z.string().nullable(),
  correlationId: z.string().nullable(),
  ts: z.string(),
});
export type AuditEntryDto = z.infer<typeof auditEntryDtoSchema>;

export const resolveRequestSchema = z.object({ winner: dashboardSourceSchema });
export type ResolveRequest = z.infer<typeof resolveRequestSchema>;
export const resolveResponseSchema = z.object({
  id: z.string(),
  resolved: z.literal(true),
  winner: dashboardSourceSchema,
});
export const replayResponseSchema = z.object({
  id: z.string(),
  status: z.literal("pending"),
  replayed: z.literal(true),
});
