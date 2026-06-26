import { createHash } from "node:crypto";
import type { InternalInvoice } from "../internal/service";

export interface QboInvoiceDefaults {
  customerRef: string;
  itemRef: string;
}

// Map an internal invoice to a QBO Invoice body. DocNumber is set to the internal
// id — that's our external-id key for idempotent check-before-create. Money is
// integer cents internally, dollars on the QBO side.
export function mapInvoiceToQbo(
  inv: InternalInvoice,
  defaults: QboInvoiceDefaults,
): Record<string, unknown> {
  return {
    DocNumber: inv.id,
    CustomerRef: { value: defaults.customerRef },
    Line: [
      {
        DetailType: "SalesItemLineDetail",
        Amount: inv.amountCents / 100,
        SalesItemLineDetail: { ItemRef: { value: defaults.itemRef } },
      },
    ],
  };
}

// A stable fingerprint of the internal invoice's synced fields. Stored on the link
// as last_synced_hash; the reverse direction compares an incoming hash to this to
// drop our own echo.
export function hashInvoice(inv: InternalInvoice): string {
  const canonical = JSON.stringify({
    id: inv.id,
    customerName: inv.customerName,
    amountCents: inv.amountCents,
    balanceCents: inv.balanceCents,
    status: inv.status,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export interface QboPaymentDefaults {
  customerRef: string;
}

// Map an internal payment to a QBO Payment body. The LinkedTxn ties it to the QBO
// invoice, which is what makes QBO reduce that invoice's Balance. PrivateNote carries
// our internal payment id for traceability. Money is dollars on the QBO side.
export function mapPaymentToQbo(
  pay: { id: string; amountCents: number },
  invoiceQboId: string,
  defaults: QboPaymentDefaults,
): Record<string, unknown> {
  return {
    TotalAmt: pay.amountCents / 100,
    CustomerRef: { value: defaults.customerRef },
    PrivateNote: `internal:${pay.id}`,
    Line: [
      {
        Amount: pay.amountCents / 100,
        LinkedTxn: [{ TxnId: invoiceQboId, TxnType: "Invoice" }],
      },
    ],
  };
}

// Fingerprint of a payment's synced fields, stored on its link.
export function hashPayment(pay: { id: string; invoiceId: string; amountCents: number }): string {
  const canonical = JSON.stringify({ id: pay.id, invoiceId: pay.invoiceId, amountCents: pay.amountCents });
  return createHash("sha256").update(canonical).digest("hex");
}
