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
