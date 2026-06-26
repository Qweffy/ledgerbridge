import { and, eq } from "drizzle-orm";
import type { EntityType, LinkStatus } from "@ledgerbridge/shared";
import { links } from "../../db/schema";
import type { Database } from "../../db/types";

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

export interface UpsertLinkInput {
  entityType: EntityType;
  internalId: string;
  qboId: string;
  lastSyncedHash: string;
  lastInternalVersion: number;
  status: LinkStatus;
}

// Idempotent mapping write: create the link the first time, update it thereafter.
export async function upsertLink(
  db: Database,
  input: UpsertLinkInput,
  now: Date = new Date(),
): Promise<void> {
  const existing = await getLinkByInternalId(db, input.entityType, input.internalId);
  if (existing) {
    await db
      .update(links)
      .set({
        qboId: input.qboId,
        lastSyncedHash: input.lastSyncedHash,
        lastInternalVersion: input.lastInternalVersion,
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
    status: input.status,
    createdAt: now,
    updatedAt: now,
  });
}
