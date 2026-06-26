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
