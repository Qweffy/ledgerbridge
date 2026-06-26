import type { Database } from "../../db/types";
import type { InternalPayment } from "../internal/service";
import type { SyncEventRow } from "./processor";
import { writeAudit } from "./audit";
import { getLinkByInternalId, upsertLink } from "./links";
import { hashPayment, mapPaymentToQbo, type QboPaymentDefaults } from "./mapping";
import type { QboPaymentOps } from "./qbo-ops";

export interface PaymentProcessorDeps {
  refetchPayment: (id: string) => Promise<InternalPayment | undefined>;
  qboPayments: QboPaymentOps;
  defaults: QboPaymentDefaults;
}

// Sync one internal payment to a QBO Payment linked to the invoice it pays. Two
// idempotency guards: a payment link row (skip if we already synced this payment)
// and a stable Request-Id on the create (Intuit dedups a retry after a lost
// response — QBO Payments have no DocNumber to query by).
export async function processPaymentToQbo(
  db: Database,
  event: SyncEventRow,
  deps: PaymentProcessorDeps,
  now: Date,
): Promise<void> {
  const payId = event.entityExternalId;
  const correlationId = event.correlationId ?? undefined;
  const base = { eventId: event.eventId, entityType: "payment" as const, entityExternalId: payId, correlationId };

  const payment = await deps.refetchPayment(payId);
  if (!payment) {
    await writeAudit(db, { ...base, action: "skip", result: "ok", error: "payment not found" }, now);
    return;
  }

  // Already synced (a re-delivery): the payment link is the record of that.
  const existing = await getLinkByInternalId(db, "payment", payId);
  if (existing?.qboId) {
    await writeAudit(db, { ...base, action: "skip", result: "ok", error: "payment already synced" }, now);
    return;
  }

  // The QBO Payment links to the invoice's QBO id, so the invoice must be synced
  // first. The invoice event is older and normally lands first; if not, retry until
  // it does (a transient error, not a dead-letter).
  const invoiceLink = await getLinkByInternalId(db, "invoice", payment.invoiceId);
  if (!invoiceLink?.qboId) {
    throw new Error(`invoice ${payment.invoiceId} not yet linked; will retry`);
  }

  const body = mapPaymentToQbo({ id: payment.id, amountCents: payment.amountCents }, invoiceLink.qboId, deps.defaults);
  const created = await deps.qboPayments.create(body, `payment:${payId}`);

  await upsertLink(
    db,
    { entityType: "payment", internalId: payId, qboId: created.Id, lastSyncedHash: hashPayment({ id: payment.id, invoiceId: payment.invoiceId, amountCents: payment.amountCents }), lastInternalVersion: 1, status: "linked" },
    now,
  );
  await writeAudit(
    db,
    { ...base, action: "create", before: { invoiceId: payment.invoiceId }, after: { qboPaymentId: created.Id, amountCents: payment.amountCents, linkedInvoiceQboId: invoiceLink.qboId }, result: "ok" },
    now,
  );
}
