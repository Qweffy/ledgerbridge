import type { InternalInvoice } from "../internal/service";
import type { QboInvoiceState } from "./qbo-ops";

// The bidirectionally-synced canonical surface of an invoice. The amount round-trips
// (internal amountCents ↔ QBO TotalAmt); status is the terminal marker. customerName
// and balanceCents are internal-only — the mapping sends a fixed CustomerRef and the
// QBO refetch never returns them — so they can't take part in a cross-system conflict.
export interface InvoiceCanonical {
  amountCents: number;
  status: "open" | "deleted";
}

export function canonicalFromInternal(inv: InternalInvoice): InvoiceCanonical {
  return { amountCents: inv.amountCents, status: inv.status === "deleted" ? "deleted" : "open" };
}

export function canonicalFromQbo(state: QboInvoiceState): InvoiceCanonical {
  return { amountCents: state.totalCents, status: state.voided ? "deleted" : "open" };
}

function eq(a: InvoiceCanonical, b: InvoiceCanonical): boolean {
  return a.amountCents === b.amountCents && a.status === b.status;
}

export type ConflictOutcome =
  | "no-basis"
  | "neither"
  | "internal-only"
  | "qbo-only"
  | "converged"
  | "conflict";

export interface ConflictAnalysis {
  internalChanged: boolean;
  qboChanged: boolean;
  outcome: ConflictOutcome;
}

// Compare both sides' current canonical state against the snapshot taken at the last
// sync. A null snapshot means there's no prior basis (a first-time or pre-M6 link) ⇒
// we can't call it a both-changed conflict; the caller just applies and records one.
export function analyze(
  snapshot: InvoiceCanonical | null,
  internal: InvoiceCanonical,
  qbo: InvoiceCanonical,
): ConflictAnalysis {
  if (!snapshot) {
    return { internalChanged: false, qboChanged: false, outcome: "no-basis" };
  }
  const internalChanged = !eq(internal, snapshot);
  const qboChanged = !eq(qbo, snapshot);
  let outcome: ConflictOutcome;
  if (!internalChanged && !qboChanged) outcome = "neither";
  else if (internalChanged && !qboChanged) outcome = "internal-only";
  else if (!internalChanged && qboChanged) outcome = "qbo-only";
  else outcome = eq(internal, qbo) ? "converged" : "conflict";
  return { internalChanged, qboChanged, outcome };
}

// The action a processor should take, given which side's event it is processing.
// "apply" = push this side's change; "skip" = this side didn't touch a synced field,
// so don't write (avoids clobbering the other side); "converged" = both reached the
// same value, just reconcile bookkeeping; "conflict" = both changed it, differently.
export type SyncAction = "apply" | "skip" | "converged" | "conflict";

export function actionFor(
  source: "internal" | "quickbooks",
  a: ConflictAnalysis,
): SyncAction {
  switch (a.outcome) {
    case "no-basis":
      return "apply";
    case "conflict":
      return "conflict";
    case "converged":
      return "converged";
    case "neither":
      return "skip";
    case "internal-only":
      return source === "internal" ? "apply" : "skip";
    case "qbo-only":
      return source === "quickbooks" ? "apply" : "skip";
  }
}
