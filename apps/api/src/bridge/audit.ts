import type { AuditAction, EntityType } from "@ledgerbridge/shared";
import { auditLog } from "../../db/schema";
import type { Database } from "../../db/types";

export interface AuditInput {
  eventId?: string;
  entityType: EntityType;
  entityExternalId: string;
  action: AuditAction;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  result: "ok" | "error";
  error?: string;
  correlationId?: string;
}

// One row per action taken, so we can always explain what changed, what we did,
// and whether it worked.
export async function writeAudit(
  db: Database,
  input: AuditInput,
  now: Date = new Date(),
): Promise<void> {
  await db.insert(auditLog).values({ ...input, ts: now });
}
