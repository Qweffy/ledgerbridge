import type { Database } from "../../db/types";
import type { InternalAccount } from "../internal/service";
import type { SyncEventRow } from "./processor";
import { writeAudit } from "./audit";
import { getLinkByInternalId, upsertLink } from "./links";
import { hashAccount, mapAccountToQbo } from "./mapping";
import type { QboAccountOps } from "./qbo-ops";

export interface AccountProcessorDeps {
  refetchAccount: (id: string) => Promise<InternalAccount | undefined>;
  qboAccounts: QboAccountOps;
}

// Sync one internal GL account to a QBO Account, idempotently and one-directionally
// (internal → QBO). Idempotency mirrors the invoice path: an unchanged re-delivery
// hashes equal and is skipped; a create that timed out *after* landing is recovered
// by find-by-Name (Name is unique in QBO) and adopted instead of duplicated; a
// stable Request-Id adds Intuit's API-level dedup on top.
export async function processAccountToQbo(
  db: Database,
  event: SyncEventRow,
  deps: AccountProcessorDeps,
  now: Date,
): Promise<void> {
  const accountId = event.entityExternalId;
  const correlationId = event.correlationId ?? undefined;
  const base = { eventId: event.eventId, entityType: "account" as const, entityExternalId: accountId, correlationId };

  const account = await deps.refetchAccount(accountId);
  if (!account) {
    await writeAudit(db, { ...base, action: "skip", result: "ok", error: "account not found" }, now);
    return;
  }

  const link = await getLinkByInternalId(db, "account", accountId);
  const hash = hashAccount(account);

  // Echo / re-delivery on a healthy link: nothing changed since our last sync.
  if (link?.status === "linked" && link.lastSyncedHash === hash) {
    await writeAudit(db, { ...base, action: "skip", result: "ok", error: "unchanged since last sync" }, now);
    return;
  }

  const body = mapAccountToQbo(account);
  let qboId: string;
  let qboVersion: number;
  let action: "create" | "update";

  if (link?.qboId) {
    // A real change to a mapped account: refetch the SyncToken and update QBO.
    const ref = await deps.qboAccounts.read(link.qboId);
    const updated = await deps.qboAccounts.update({ ...body, Id: ref.Id, SyncToken: ref.SyncToken });
    qboId = updated.Id;
    qboVersion = Number(updated.SyncToken);
    action = "update";
  } else {
    const existing = await deps.qboAccounts.findByName(account.name);
    if (existing) {
      // Created on a prior attempt whose link write was lost (timeout after the
      // external write). Adopt it and reflect current state — no duplicate.
      const updated = await deps.qboAccounts.update({ ...body, Id: existing.Id, SyncToken: existing.SyncToken });
      qboId = updated.Id;
      qboVersion = Number(updated.SyncToken);
      action = "update";
    } else {
      const created = await deps.qboAccounts.create(body, `account:${account.id}:${account.version}`);
      qboId = created.Id;
      qboVersion = Number(created.SyncToken);
      action = "create";
    }
  }

  await upsertLink(
    db,
    { entityType: "account", internalId: accountId, qboId, lastSyncedHash: hash, lastInternalVersion: account.version, lastQboVersion: qboVersion, status: "linked" },
    now,
  );
  await writeAudit(
    db,
    { ...base, action, before: link ? { qboId: link.qboId } : undefined, after: { qboId, name: account.name, acctType: account.acctType }, result: "ok" },
    now,
  );
}
