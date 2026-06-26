import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  type AuditEntryDto,
  type ConflictDetailDto,
  type ConflictDto,
  type EntityType,
  type EventDetailDto,
  type EventDto,
  type EventStatus,
  type LinkDetailDto,
  type LinkDto,
  type StatusDto,
  systemIdToSource,
  sourceToSystemId,
  type DashboardSource,
  type LinkStatus,
} from "@ledgerbridge/shared";
import { auditLog, links, syncEvents } from "../../db/schema";
import type { Database } from "../../db/types";
import { getInvoice } from "../internal/service";
import { getLinkById } from "../bridge/links";
import { DEFAULT_MAX_ATTEMPTS } from "../bridge/worker";

type EventRow = typeof syncEvents.$inferSelect;
type LinkRow = typeof links.$inferSelect;
type AuditRow = typeof auditLog.$inferSelect;

// Timestamps come back from the driver as Date (column selects) or string (raw sql);
// normalise everything the API emits to ISO 8601 (which the dashboard's parser reads).
function toIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function auditDetail(row: { action: string; result: string; error: string | null }): string {
  return row.error ?? `${row.action} · ${row.result}`;
}

async function timelineFor(db: Database, externalId: string) {
  const rows = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.entityExternalId, externalId))
    .orderBy(desc(auditLog.ts))
    .limit(50);
  return rows.map((a) => ({
    ts: toIso(a.ts) ?? "",
    action: a.action,
    result: a.result,
    detail: auditDetail(a),
  }));
}

// ---- /status ----
export async function getStatus(db: Database): Promise<StatusDto> {
  const counts = { pending: 0, processing: 0, done: 0, dead: 0 };
  const grouped = await db
    .select({ status: syncEvents.status, n: sql<number>`count(*)::int` })
    .from(syncEvents)
    .groupBy(syncEvents.status);
  for (const r of grouped) counts[r.status] = Number(r.n);

  const [lag] = await db
    .select({ sec: sql<number | null>`extract(epoch from now() - min(${syncEvents.receivedAt}))::int` })
    .from(syncEvents)
    .where(eq(syncEvents.status, "pending"));
  const [conflicts] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(links)
    .where(eq(links.status, "conflict"));
  const [recon] = await db
    .select({ ts: sql<string | null>`max(${auditLog.ts})` })
    .from(auditLog)
    .where(eq(auditLog.correlationId, "reconcile:heartbeat"));

  return {
    counts,
    oldestPendingLagSec: lag?.sec == null ? null : Number(lag.sec),
    deadLetterCount: counts.dead,
    conflictCount: Number(conflicts?.n ?? 0),
    lastReconcileAt: toIso(recon?.ts),
  };
}

// ---- /events ----
function eventRowToDto(row: EventRow): EventDto {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const operation = String(
    payload.operation ?? payload.changeType ?? (payload.reconcile ? "reconcile" : "unknown"),
  );
  return {
    id: String(row.id),
    eventId: row.eventId,
    source: systemIdToSource(row.source),
    entityType: row.entityType,
    externalId: row.entityExternalId,
    operation,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    nextAttemptAt: toIso(row.nextAttemptAt),
    lastError: row.lastError,
    receivedAt: toIso(row.receivedAt),
    correlationId: row.correlationId,
  };
}

export interface EventsFilter {
  status?: EventStatus;
  source?: DashboardSource;
  entityType?: EntityType;
  limit?: number;
}

export async function listEvents(db: Database, filter: EventsFilter): Promise<EventDto[]> {
  const conds = [];
  if (filter.status) conds.push(eq(syncEvents.status, filter.status));
  if (filter.source) conds.push(eq(syncEvents.source, sourceToSystemId(filter.source)));
  if (filter.entityType) conds.push(eq(syncEvents.entityType, filter.entityType));
  const rows = await db
    .select()
    .from(syncEvents)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(syncEvents.id))
    .limit(filter.limit ?? 100);
  return rows.map(eventRowToDto);
}

export async function getEvent(db: Database, id: number): Promise<EventDetailDto | undefined> {
  const [row] = await db.select().from(syncEvents).where(eq(syncEvents.id, id)).limit(1);
  if (!row) return undefined;
  return {
    ...eventRowToDto(row),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    auditTrail: await timelineFor(db, row.entityExternalId),
  };
}

export async function replayEvent(
  db: Database,
  id: number,
  now: Date,
): Promise<"replayed" | "not_found" | "processing"> {
  const [row] = await db.select().from(syncEvents).where(eq(syncEvents.id, id)).limit(1);
  if (!row) return "not_found";
  if (row.status === "processing") return "processing"; // racing the worker — refuse
  await db
    .update(syncEvents)
    .set({ status: "pending", attempts: 0, nextAttemptAt: now, lockedAt: null, lockedBy: null, lastError: null })
    .where(eq(syncEvents.id, id));
  return "replayed";
}

// ---- /links ----
// One query for every entity with a reconcile resync in flight; a link "drifts" (a
// repair is queued) if either of its ids is in that set.
async function driftingSet(db: Database): Promise<Set<string>> {
  const rows = await db
    .select({ ext: syncEvents.entityExternalId })
    .from(syncEvents)
    .where(and(inArray(syncEvents.status, ["pending", "processing"]), sql`${syncEvents.correlationId} like 'reconcile:%'`));
  return new Set(rows.map((r) => r.ext));
}

function linkRowToDto(row: LinkRow, drifting: Set<string>): LinkDto {
  const drift =
    (row.internalId != null && drifting.has(row.internalId)) ||
    (row.qboId != null && drifting.has(row.qboId));
  return {
    id: String(row.id),
    entityType: row.entityType,
    internalId: row.internalId,
    qboId: row.qboId,
    status: row.status,
    lastSyncedAt: toIso(row.updatedAt),
    drift,
  };
}

export interface LinksFilter {
  status?: LinkStatus;
  entityType?: EntityType;
  limit?: number;
}

export async function listLinks(db: Database, filter: LinksFilter): Promise<LinkDto[]> {
  const conds = [];
  if (filter.status) conds.push(eq(links.status, filter.status));
  if (filter.entityType) conds.push(eq(links.entityType, filter.entityType));
  const rows = await db
    .select()
    .from(links)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(links.updatedAt))
    .limit(filter.limit ?? 100);
  const drifting = await driftingSet(db);
  return rows.map((r) => linkRowToDto(r, drifting));
}

export async function getLink(db: Database, id: number): Promise<LinkDetailDto | undefined> {
  const link = await getLinkById(db, id);
  if (!link) return undefined;
  const inv = link.internalId ? await getInvoice(db, link.internalId) : undefined;
  const internalSnapshot: Record<string, string> = inv
    ? {
        DocNumber: inv.id,
        TotalAmount: dollars(inv.amountCents),
        Balance: dollars(inv.balanceCents),
        CustomerRef: inv.customerName,
        Status: inv.status,
      }
    : {};
  const qboSnapshot: Record<string, string> = link.lastSyncedSnapshot
    ? { TotalAmount: dollars(link.lastSyncedSnapshot.amountCents), Status: link.lastSyncedSnapshot.status }
    : {};
  const drifting = await driftingSet(db);
  return {
    ...linkRowToDto(link, drifting),
    internalSnapshot,
    qboSnapshot,
    timeline: link.internalId ? await timelineFor(db, link.internalId) : [],
  };
}

// ---- /conflicts ----
// Read the flag-time truth from the latest `conflict` audit row, tolerating its three
// shapes (processor conflict / reconcile mismatch / reconcile ambiguous).
function interpretConflict(audit: AuditRow | undefined): {
  conflictingFields: string[];
  reason: string;
  before: Record<string, string>;
  after: Record<string, string>;
} {
  if (!audit) return { conflictingFields: [], reason: "Conflict", before: {}, after: {} };
  const a = (audit.after ?? {}) as Record<string, unknown>;
  const b = (audit.before ?? {}) as Record<string, unknown>;
  const internalCents = a.internalAmountCents ?? b.internalAmountCents;
  const qboCents = a.qboAmountCents;
  if (typeof internalCents === "number" && typeof qboCents === "number") {
    return {
      conflictingFields: ["TotalAmount"],
      reason: audit.error ?? "Amount mismatch",
      before: { TotalAmount: dollars(internalCents) },
      after: { TotalAmount: dollars(qboCents) },
    };
  }
  return { conflictingFields: [], reason: audit.error ?? "Conflict", before: {}, after: {} };
}

async function latestConflictAudit(db: Database, externalId: string): Promise<AuditRow | undefined> {
  const [row] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityExternalId, externalId), eq(auditLog.action, "conflict")))
    .orderBy(desc(auditLog.ts))
    .limit(1);
  return row;
}

async function buildConflict(db: Database, link: LinkRow): Promise<ConflictDetailDto> {
  const audit = link.internalId ? await latestConflictAudit(db, link.internalId) : undefined;
  const inv = link.internalId ? await getInvoice(db, link.internalId) : undefined;
  const { conflictingFields, reason, before, after } = interpretConflict(audit);
  return {
    id: String(link.id),
    linkId: String(link.id),
    eventId: audit?.eventId ?? "",
    entityType: link.entityType,
    internalId: link.internalId,
    customer: inv?.customerName ?? "—",
    reason,
    openedAt: toIso(audit?.ts ?? link.updatedAt),
    conflictingFields,
    before,
    after,
  };
}

export async function listConflicts(db: Database): Promise<ConflictDto[]> {
  const rows = await db
    .select()
    .from(links)
    .where(eq(links.status, "conflict"))
    .orderBy(desc(links.updatedAt))
    .limit(100);
  const out: ConflictDto[] = [];
  for (const link of rows) {
    const d = await buildConflict(db, link);
    out.push({
      id: d.id,
      linkId: d.linkId,
      eventId: d.eventId,
      entityType: d.entityType,
      internalId: d.internalId,
      customer: d.customer,
      reason: d.reason,
      openedAt: d.openedAt,
      conflictingFields: d.conflictingFields,
    });
  }
  return out;
}

export async function getConflict(db: Database, id: number): Promise<ConflictDetailDto | undefined> {
  const link = await getLinkById(db, id);
  if (!link || link.status !== "conflict") return undefined;
  return buildConflict(db, link);
}

// ---- /audit ----
function auditRowToDto(row: AuditRow): AuditEntryDto {
  return {
    id: String(row.id),
    eventId: row.eventId,
    entityType: row.entityType,
    action: row.action,
    before: row.before ?? null,
    after: row.after ?? null,
    result: row.result,
    error: row.error,
    correlationId: row.correlationId,
    ts: toIso(row.ts) ?? "",
  };
}

export async function listAudit(db: Database, limit = 100): Promise<AuditEntryDto[]> {
  const rows = await db.select().from(auditLog).orderBy(desc(auditLog.ts)).limit(limit);
  return rows.map(auditRowToDto);
}
