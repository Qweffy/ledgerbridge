import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { internalAccounts, internalChanges, internalInvoices, internalPayments } from "../../db/internal";
import type { Database } from "../../db/types";
import type { ChangeEvent, ChangeSink } from "./sink";

export type InternalInvoice = typeof internalInvoices.$inferSelect;
export type InternalPayment = typeof internalPayments.$inferSelect;
export type InternalAccount = typeof internalAccounts.$inferSelect;

export interface CreateInvoiceInput {
  customerName: string;
  amountCents: number;
  docNumber?: string;
  currency?: string;
}
export interface UpdateInvoiceInput {
  customerName?: string;
  amountCents?: number;
}

export class NotFoundError extends Error {}

function newId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function snapshotOf(inv: InternalInvoice): Record<string, unknown> {
  return {
    id: inv.id,
    docNumber: inv.docNumber,
    customerName: inv.customerName,
    status: inv.status,
    amountCents: inv.amountCents,
    balanceCents: inv.balanceCents,
    currency: inv.currency,
    version: inv.version,
  };
}

// Append a change row, then emit one signed webhook for it. event_id is stable
// (the change row's id) so the bridge can dedupe re-deliveries.
async function emitChange(
  db: Database,
  sink: ChangeSink,
  params: {
    entity: ChangeEvent["entity"];
    entityId: string;
    changeType: ChangeEvent["changeType"];
    version: number;
    snapshot: Record<string, unknown>;
  },
): Promise<void> {
  const [change] = await db
    .insert(internalChanges)
    .values({
      entity: params.entity,
      entityId: params.entityId,
      changeType: params.changeType,
      version: params.version,
      snapshot: params.snapshot,
    })
    .returning({ id: internalChanges.id });
  if (!change) throw new Error("failed to record change");

  const event: ChangeEvent = {
    eventId: `internal:change:${change.id}`,
    entity: params.entity,
    entityId: params.entityId,
    changeType: params.changeType,
    version: params.version,
    occurredAt: new Date().toISOString(),
  };
  await sink.emit(event);
  await db
    .update(internalChanges)
    .set({ delivered: true })
    .where(eq(internalChanges.id, change.id));
}

async function loadInvoice(db: Database, id: string): Promise<InternalInvoice> {
  const inv = await getInvoice(db, id);
  if (!inv) throw new NotFoundError(`invoice ${id} not found`);
  return inv;
}

export async function getInvoice(
  db: Database,
  id: string,
): Promise<InternalInvoice | undefined> {
  const [inv] = await db
    .select()
    .from(internalInvoices)
    .where(eq(internalInvoices.id, id))
    .limit(1);
  return inv;
}

export async function getPayment(
  db: Database,
  id: string,
): Promise<InternalPayment | undefined> {
  const [payment] = await db
    .select()
    .from(internalPayments)
    .where(eq(internalPayments.id, id))
    .limit(1);
  return payment;
}

// The reconciler scans every internal invoice to match unlinked ones and recover
// dropped changes.
export async function listInvoices(db: Database): Promise<InternalInvoice[]> {
  return db.select().from(internalInvoices);
}

export async function createInvoice(
  db: Database,
  sink: ChangeSink,
  input: CreateInvoiceInput,
): Promise<InternalInvoice> {
  const id = newId("INV");
  const [inv] = await db
    .insert(internalInvoices)
    .values({
      id,
      docNumber: input.docNumber ?? id,
      customerName: input.customerName,
      amountCents: input.amountCents,
      balanceCents: input.amountCents,
      currency: input.currency ?? "USD",
      status: "open",
      version: 1,
    })
    .returning();
  if (!inv) throw new Error("failed to create invoice");
  await emitChange(db, sink, {
    entity: "invoice",
    entityId: inv.id,
    changeType: "create",
    version: inv.version,
    snapshot: snapshotOf(inv),
  });
  return inv;
}

export async function updateInvoice(
  db: Database,
  sink: ChangeSink,
  id: string,
  patch: UpdateInvoiceInput,
): Promise<InternalInvoice> {
  const current = await loadInvoice(db, id);
  const paidCents = current.amountCents - current.balanceCents;
  const amountCents = patch.amountCents ?? current.amountCents;
  const balanceCents = Math.max(0, amountCents - paidCents);
  const status =
    balanceCents === 0 ? "paid" : paidCents > 0 ? "partially_paid" : "open";
  const [inv] = await db
    .update(internalInvoices)
    .set({
      customerName: patch.customerName ?? current.customerName,
      amountCents,
      balanceCents,
      status,
      version: current.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(internalInvoices.id, id))
    .returning();
  if (!inv) throw new Error("failed to update invoice");
  await emitChange(db, sink, {
    entity: "invoice",
    entityId: inv.id,
    changeType: "update",
    version: inv.version,
    snapshot: snapshotOf(inv),
  });
  return inv;
}

export async function recordPayment(
  db: Database,
  sink: ChangeSink,
  invoiceId: string,
  amountCents: number,
): Promise<{ invoice: InternalInvoice; payment: InternalPayment }> {
  const current = await loadInvoice(db, invoiceId);
  if (current.status === "deleted") {
    throw new NotFoundError(`invoice ${invoiceId} is deleted`);
  }
  const [payment] = await db
    .insert(internalPayments)
    .values({ id: newId("PAY"), invoiceId, amountCents })
    .returning();
  if (!payment) throw new Error("failed to record payment");
  const balanceCents = Math.max(0, current.balanceCents - amountCents);
  const status = balanceCents === 0 ? "paid" : "partially_paid";
  const [inv] = await db
    .update(internalInvoices)
    .set({
      balanceCents,
      status,
      version: current.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(internalInvoices.id, invoiceId))
    .returning();
  if (!inv) throw new Error("failed to update invoice balance");
  // A payment is its own entity: it syncs to a QBO Payment (which reduces the QBO
  // invoice's balance), so it's emitted as a payment change, not an invoice update.
  await emitChange(db, sink, {
    entity: "payment",
    entityId: payment.id,
    changeType: "pay",
    version: 1,
    snapshot: { id: payment.id, invoiceId, amountCents, balanceCents: inv.balanceCents },
  });
  return { invoice: inv, payment };
}

export async function deleteInvoice(
  db: Database,
  sink: ChangeSink,
  id: string,
): Promise<InternalInvoice> {
  const current = await loadInvoice(db, id);
  const [inv] = await db
    .update(internalInvoices)
    .set({
      status: "deleted",
      deletedAt: new Date(),
      version: current.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(internalInvoices.id, id))
    .returning();
  if (!inv) throw new Error("failed to delete invoice");
  await emitChange(db, sink, {
    entity: "invoice",
    entityId: inv.id,
    changeType: "delete",
    version: inv.version,
    snapshot: snapshotOf(inv),
  });
  return inv;
}

export interface CreateAccountInput {
  name: string;
  acctType: string;
  acctNum?: string;
  active?: boolean;
}
export interface UpdateAccountInput {
  name?: string;
  acctType?: string;
  acctNum?: string;
  active?: boolean;
}

function accountSnapshotOf(acct: InternalAccount): Record<string, unknown> {
  return {
    id: acct.id,
    name: acct.name,
    acctType: acct.acctType,
    acctNum: acct.acctNum,
    active: acct.active,
    version: acct.version,
  };
}

export async function getAccount(
  db: Database,
  id: string,
): Promise<InternalAccount | undefined> {
  const [acct] = await db
    .select()
    .from(internalAccounts)
    .where(eq(internalAccounts.id, id))
    .limit(1);
  return acct;
}

export async function listAccounts(db: Database): Promise<InternalAccount[]> {
  return db.select().from(internalAccounts);
}

async function loadAccount(db: Database, id: string): Promise<InternalAccount> {
  const acct = await getAccount(db, id);
  if (!acct) throw new NotFoundError(`account ${id} not found`);
  return acct;
}

export async function createAccount(
  db: Database,
  sink: ChangeSink,
  input: CreateAccountInput,
): Promise<InternalAccount> {
  const id = newId("ACCT");
  const [acct] = await db
    .insert(internalAccounts)
    .values({
      id,
      name: input.name,
      acctType: input.acctType,
      acctNum: input.acctNum,
      active: input.active ?? true,
      version: 1,
    })
    .returning();
  if (!acct) throw new Error("failed to create account");
  await emitChange(db, sink, {
    entity: "account",
    entityId: acct.id,
    changeType: "create",
    version: acct.version,
    snapshot: accountSnapshotOf(acct),
  });
  return acct;
}

export async function updateAccount(
  db: Database,
  sink: ChangeSink,
  id: string,
  patch: UpdateAccountInput,
): Promise<InternalAccount> {
  const current = await loadAccount(db, id);
  const [acct] = await db
    .update(internalAccounts)
    .set({
      name: patch.name ?? current.name,
      acctType: patch.acctType ?? current.acctType,
      acctNum: patch.acctNum ?? current.acctNum,
      active: patch.active ?? current.active,
      version: current.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(internalAccounts.id, id))
    .returning();
  if (!acct) throw new Error("failed to update account");
  await emitChange(db, sink, {
    entity: "account",
    entityId: acct.id,
    changeType: "update",
    version: acct.version,
    snapshot: accountSnapshotOf(acct),
  });
  return acct;
}
