import { and, eq } from "drizzle-orm";
import type { EntityType, LinkStatus } from "@ledgerbridge/shared";
import { links } from "../../db/schema";
import type { Database } from "../../db/types";
import type { InvoiceCanonical } from "./conflict";

export type LinkRow = typeof links.$inferSelect;

export async function getLinkByInternalId(
  db: Database,
  entityType: EntityType,
  internalId: string,
): Promise<LinkRow | undefined> {
  const [row] = await db
    .select()
    .from(links)
    .where(and(eq(links.entityType, entityType), eq(links.internalId, internalId)))
    .limit(1);
  return row;
}

// The reverse direction starts from a QBO id (the webhook's entity id) and needs
// the link to recover the internal id and the last QBO version we wrote back.
export async function getLinkByQboId(
  db: Database,
  entityType: EntityType,
  qboId: string,
): Promise<LinkRow | undefined> {
  const [row] = await db
    .select()
    .from(links)
    .where(and(eq(links.entityType, entityType), eq(links.qboId, qboId)))
    .limit(1);
  return row;
}

// Conflict resolution addresses a link by its surrogate id.
export async function getLinkById(db: Database, id: number): Promise<LinkRow | undefined> {
  const [row] = await db.select().from(links).where(eq(links.id, id)).limit(1);
  return row;
}

// Flag a link as conflicted without touching its last-synced basis (snapshot /
// versions / hash), so re-evaluation while it's held compares against the same point.
export async function markLinkConflict(
  db: Database,
  id: number,
  now: Date = new Date(),
): Promise<void> {
  await db.update(links).set({ status: "conflict", updatedAt: now }).where(eq(links.id, id));
}

export interface UpsertLinkInput {
  entityType: EntityType;
  internalId: string;
  qboId: string;
  lastSyncedHash: string;
  lastInternalVersion: number;
  // The QBO SyncToken we last wrote or observed. Echo detection compares an
  // incoming change's version to this to drop our own write-back.
  lastQboVersion?: number;
  // Canonical comparable state ({amountCents, status}) at this sync — the basis the
  // next event's conflict check diffs against.
  lastSyncedSnapshot?: InvoiceCanonical;
  status: LinkStatus;
}

// Idempotent mapping write: create the link the first time, update it thereafter.
export async function upsertLink(
  db: Database,
  input: UpsertLinkInput,
  now: Date = new Date(),
): Promise<void> {
  const qboVersion =
    input.lastQboVersion !== undefined ? { lastQboVersion: input.lastQboVersion } : {};
  const snapshot =
    input.lastSyncedSnapshot !== undefined ? { lastSyncedSnapshot: input.lastSyncedSnapshot } : {};
  const existing = await getLinkByInternalId(db, input.entityType, input.internalId);
  if (existing) {
    await db
      .update(links)
      .set({
        qboId: input.qboId,
        lastSyncedHash: input.lastSyncedHash,
        lastInternalVersion: input.lastInternalVersion,
        ...qboVersion,
        ...snapshot,
        status: input.status,
        updatedAt: now,
      })
      .where(eq(links.id, existing.id));
    return;
  }
  await db.insert(links).values({
    entityType: input.entityType,
    internalId: input.internalId,
    qboId: input.qboId,
    lastSyncedHash: input.lastSyncedHash,
    lastInternalVersion: input.lastInternalVersion,
    ...qboVersion,
    ...snapshot,
    status: input.status,
    createdAt: now,
    updatedAt: now,
  });
}
