// LedgerBridge — Drizzle schema (Postgres).
// Core sync tables. Enum values come from packages/shared so the DB, the API and
// the web UI all speak one vocabulary. The actual invoice/payment data is NOT stored
// here — we refetch current state from the source of truth on every event (see
// DESIGN.md). These tables hold the mapping, the event inbox/outbox, the audit trail
// and the QBO tokens.

import { eq, sql } from "drizzle-orm";
import {
  bigserial,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  pgView,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  AUDIT_ACTIONS,
  ENTITY_TYPES,
  EVENT_STATUSES,
  LINK_STATUSES,
  SYSTEM_IDS,
} from "@ledgerbridge/shared";

export const entityType = pgEnum("entity_type", ENTITY_TYPES);
export const systemId = pgEnum("system_id", SYSTEM_IDS);
export const eventStatus = pgEnum("event_status", EVENT_STATUSES);
export const linkStatus = pgEnum("link_status", LINK_STATUSES);
export const auditAction = pgEnum("audit_action", AUDIT_ACTIONS);
export const auditResult = pgEnum("audit_result", ["ok", "error"]);

// links — internal_id ↔ qbo_id mapping per entity, plus the last-synced fingerprint
// that conflict detection and echo detection are built on.
export const links = pgTable(
  "links",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    entityType: entityType("entity_type").notNull(),
    internalId: text("internal_id"),
    qboId: text("qbo_id"),
    // hash of the last state we synced — equal incoming hash ⇒ our own echo, drop it.
    lastSyncedHash: text("last_synced_hash"),
    lastInternalVersion: integer("last_internal_version"),
    lastQboVersion: integer("last_qbo_version"),
    status: linkStatus("status").notNull().default("linked"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("links_internal_uq")
      .on(t.entityType, t.internalId)
      .where(sql`${t.internalId} is not null`),
    uniqueIndex("links_qbo_uq")
      .on(t.entityType, t.qboId)
      .where(sql`${t.qboId} is not null`),
  ],
);

// sync_events — the durable inbox/outbox. event_id UNIQUE is the idempotency key:
// a duplicate delivery hits the constraint and is dropped. Lease columns let one
// worker claim a row with FOR UPDATE SKIP LOCKED and reclaim stale ones.
export const syncEvents = pgTable(
  "sync_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    eventId: text("event_id").notNull(),
    source: systemId("source").notNull(),
    entityType: entityType("entity_type").notNull(),
    entityExternalId: text("entity_external_id").notNull(),
    status: eventStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    lastError: text("last_error"),
    correlationId: text("correlation_id"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("sync_events_event_id_uq").on(t.eventId),
    // the worker poll: claim due, unfinished work oldest-first.
    index("sync_events_due_idx").on(t.status, t.nextAttemptAt),
  ],
);

// audit_log — one row per action taken: what changed, what we did, and whether it worked.
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    eventId: text("event_id"),
    entityType: entityType("entity_type"),
    entityExternalId: text("entity_external_id"),
    action: auditAction("action").notNull(),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    result: auditResult("result").notNull(),
    error: text("error"),
    correlationId: text("correlation_id"),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_ts_idx").on(t.ts)],
);

// oauth_tokens — QBO realm credentials. One row per connected company (realm).
export const oauthTokens = pgTable("oauth_tokens", {
  realmId: text("realm_id").primaryKey(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// dead_letter — events that exhausted retries (permanent failures), for the
// observability dashboard and the replay endpoint.
export const deadLetter = pgView("dead_letter").as((qb) =>
  qb.select().from(syncEvents).where(eq(syncEvents.status, "dead")),
);
