import type { LinkDto } from "@ledgerbridge/shared";

// RFC-4180 cell escaping: wrap in quotes when the value holds a comma, quote, or
// newline, doubling any embedded quote.
function escapeCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Serialize the linked entities the Invoices screen shows to CSV (header + rows).
// Pure, so the Export button's payload is unit-tested without a DOM.
export function linksToCsv(rows: LinkDto[]): string {
  const header = ["entity", "internal_id", "qbo_id", "status", "last_synced_at", "drift"];
  const lines = rows.map((r) =>
    [r.entityType, r.internalId ?? "", r.qboId ?? "", r.status, r.lastSyncedAt ?? "", String(r.drift)]
      .map((cell) => escapeCell(cell))
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}
