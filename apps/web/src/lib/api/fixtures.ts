/* LedgerBridge — mock fixtures (ported from the design bundle's fixtures.jsx).
   The whole dashboard renders on this when NEXT_PUBLIC_API_URL is unset. Status
   vocabulary is fixed (see the design system); never improvise synonyms. */
import type {
  AuditEntryDto,
  ConflictDto,
  EventDto,
  LinkDto,
  StatusDto,
} from "@ledgerbridge/shared";

export type Snapshot = Record<string, string>;
export interface TimelineEntry {
  ts: string;
  action: string;
  result: string;
  detail: string;
}
export interface LinkDetailExtra {
  internalSnapshot: Snapshot;
  qboSnapshot: Snapshot;
  timeline: TimelineEntry[];
}
export interface ConflictDetailExtra {
  conflictingFields: string[];
  before: Snapshot;
  after: Snapshot;
}
export interface EventDetailExtra {
  payload: Record<string, unknown>;
  auditTrail: TimelineEntry[];
}

export interface Fixtures {
  NOW: string;
  status: StatusDto;
  links: LinkDto[];
  linkDetail: Record<string, LinkDetailExtra>;
  conflicts: ConflictDto[];
  conflictDetail: Record<string, ConflictDetailExtra>;
  events: EventDto[];
  eventDetail: Record<string, EventDetailExtra>;
  audit: AuditEntryDto[];
}

const NOW = "2026-06-25 14:02:11Z";

const status: StatusDto = {
  counts: { pending: 12, processing: 3, done: 18452, dead: 3 },
  oldestPendingLagSec: 47,
  deadLetterCount: 3,
  conflictCount: 3,
  lastReconcileAt: "2026-06-25 14:01:58Z",
};

const links: LinkDto[] = [
  { id: "lnk_20294", entityType: "invoice", internalId: "INV-20294", qboId: "QBO-5582", status: "conflict", lastSyncedAt: "2026-06-25 14:02:11Z", drift: true },
  { id: "lnk_20296", entityType: "invoice", internalId: "INV-20296", qboId: "QBO-5584", status: "linked", lastSyncedAt: "2026-06-25 14:01:58Z", drift: false },
  { id: "lnk_20291", entityType: "invoice", internalId: "INV-20291", qboId: null, status: "error", lastSyncedAt: "2026-06-25 14:01:40Z", drift: false },
  { id: "lnk_20281", entityType: "invoice", internalId: "INV-20281", qboId: "QBO-5571", status: "conflict", lastSyncedAt: "2026-06-25 13:56:02Z", drift: true },
  { id: "lnk_cus_88", entityType: "account", internalId: "CUS-00088", qboId: "QBO-C19", status: "linked", lastSyncedAt: "2026-06-25 13:40:10Z", drift: false },
  { id: "lnk_pay_31", entityType: "payment", internalId: "PAY-00731", qboId: "QBO-P88", status: "linked", lastSyncedAt: "2026-06-25 13:12:44Z", drift: false },
];

const linkDetail: Record<string, LinkDetailExtra> = {
  lnk_20294: {
    internalSnapshot: { DocNumber: "INV-20294", TotalAmount: "12480.00", TxnDate: "2026-06-22", CurrencyRef: "USD", "Line[3].Amount": "180.00", CustomerRef: "Northwind Traders" },
    qboSnapshot: { DocNumber: "INV-20294", TotalAmount: "12300.00", TxnDate: "2026-06-22", CurrencyRef: "USD", "Line[3].Amount": "0.00", CustomerRef: "Northwind Traders" },
    timeline: [
      { ts: "2026-06-25 14:02:11Z", action: "conflict", result: "ok", detail: "Conflict opened — amount mismatch" },
      { ts: "2026-06-25 14:02:08Z", action: "error", result: "error", detail: "QBO 6140 — Duplicate Document Number" },
      { ts: "2026-06-25 14:02:05Z", action: "update", result: "ok", detail: "Event received from internal invoicing" },
      { ts: "2026-06-22 09:14:00Z", action: "create", result: "ok", detail: "Link established · internal → QBO" },
    ],
  },
  lnk_20296: {
    internalSnapshot: { DocNumber: "INV-20296", TotalAmount: "84205.18", TxnDate: "2026-06-24", CurrencyRef: "USD", CustomerRef: "Globex Corp" },
    qboSnapshot: { DocNumber: "INV-20296", TotalAmount: "84205.18", TxnDate: "2026-06-24", CurrencyRef: "USD", CustomerRef: "Globex Corp" },
    timeline: [
      { ts: "2026-06-25 14:01:58Z", action: "update", result: "ok", detail: "Synced from QBO → internal" },
      { ts: "2026-06-24 11:30:00Z", action: "create", result: "ok", detail: "Link established · internal → QBO" },
    ],
  },
  lnk_20291: {
    internalSnapshot: { DocNumber: "INV-20291", TotalAmount: "540.00", TxnDate: "2026-06-24", CurrencyRef: "USD", CustomerRef: "Initech" },
    qboSnapshot: {},
    timeline: [
      { ts: "2026-06-25 14:01:40Z", action: "error", result: "error", detail: "Max retries exhausted → dead-letter" },
      { ts: "2026-06-25 14:01:37Z", action: "error", result: "error", detail: "QBO 500 — service unavailable (attempt 2)" },
      { ts: "2026-06-25 14:01:33Z", action: "create", result: "error", detail: "POST /v3/.../invoice — attempt 1 failed" },
    ],
  },
  lnk_20281: {
    internalSnapshot: { DocNumber: "INV-20281", TotalAmount: "4300.00", TxnDate: "2026-06-20", CustomerMemo: "Net-30, PO #88421", CustomerRef: "Vandelay Industries" },
    qboSnapshot: { DocNumber: "INV-20281", TotalAmount: "4300.00", TxnDate: "2026-06-20", CustomerMemo: "Net-45, PO #88421", CustomerRef: "Vandelay Industries" },
    timeline: [
      { ts: "2026-06-25 13:56:02Z", action: "conflict", result: "ok", detail: "Conflict opened — both sides edited CustomerMemo" },
      { ts: "2026-06-20 16:05:00Z", action: "create", result: "ok", detail: "Link established · internal → QBO" },
    ],
  },
  lnk_cus_88: {
    internalSnapshot: { DisplayName: "Pied Piper LLC", Email: "ar@piedpiper.com", Terms: "Net-30", Currency: "USD" },
    qboSnapshot: { DisplayName: "Pied Piper LLC", Email: "ar@piedpiper.com", Terms: "Net-30", Currency: "USD" },
    timeline: [
      { ts: "2026-06-25 13:40:10Z", action: "update", result: "ok", detail: "Synced from internal → QBO" },
      { ts: "2026-06-18 10:00:00Z", action: "create", result: "ok", detail: "Customer linked" },
    ],
  },
  lnk_pay_31: {
    internalSnapshot: { TxnId: "PAY-00731", Amount: "310.75", AppliedTo: "INV-20289", Method: "ACH" },
    qboSnapshot: { TxnId: "PAY-00731", Amount: "310.75", AppliedTo: "INV-20289", Method: "ACH" },
    timeline: [{ ts: "2026-06-25 13:12:44Z", action: "create", result: "ok", detail: "Payment linked · QBO → internal" }],
  },
};

const conflicts: ConflictDto[] = [
  { id: "cf_1042", linkId: "lnk_20294", eventId: "evt_8f2a91c4", entityType: "invoice", internalId: "INV-20294", customer: "Northwind Traders", reason: "Amount mismatch", openedAt: "2026-06-25 14:02:11Z", conflictingFields: ["TotalAmount", "Line[3].Amount"] },
  { id: "cf_1041", linkId: "lnk_20281", eventId: "evt_70bc12a9", entityType: "invoice", internalId: "INV-20281", customer: "Vandelay Industries", reason: "Both sides edited", openedAt: "2026-06-25 13:56:02Z", conflictingFields: ["CustomerMemo"] },
  { id: "cf_1039", linkId: "lnk_20275", eventId: "evt_44ff0c10", entityType: "invoice", internalId: "INV-20275", customer: "Cyberdyne Systems", reason: "Currency mismatch", openedAt: "2026-06-25 13:41:30Z", conflictingFields: ["CurrencyRef", "ExchangeRate"] },
];

const conflictDetail: Record<string, ConflictDetailExtra> = {
  cf_1042: {
    conflictingFields: ["TotalAmount", "Line[3].Amount"],
    before: { TotalAmount: "12480.00", TxnDate: "2026-06-22", "Line[3].Amount": "180.00", CurrencyRef: "USD", CustomerRef: "Northwind Traders" },
    after: { TotalAmount: "12300.00", TxnDate: "2026-06-22", "Line[3].Amount": "0.00", CurrencyRef: "USD", CustomerRef: "Northwind Traders" },
  },
  cf_1041: {
    conflictingFields: ["CustomerMemo"],
    before: { CustomerMemo: "Net-30, PO #88421", TotalAmount: "4300.00", TxnDate: "2026-06-20", CustomerRef: "Vandelay Industries" },
    after: { CustomerMemo: "Net-45, PO #88421", TotalAmount: "4300.00", TxnDate: "2026-06-20", CustomerRef: "Vandelay Industries" },
  },
  cf_1039: {
    conflictingFields: ["CurrencyRef", "ExchangeRate"],
    before: { CurrencyRef: "USD", ExchangeRate: "1.000", TotalAmount: "9870.00", CustomerRef: "Cyberdyne Systems" },
    after: { CurrencyRef: "CAD", ExchangeRate: "1.361", TotalAmount: "9870.00", CustomerRef: "Cyberdyne Systems" },
  },
};

const events: EventDto[] = [
  { id: "evt_8f2a91c4", eventId: "evt_8f2a91c4", source: "internal", entityType: "invoice", externalId: "INV-20294", operation: "update", status: "processing", attempts: 2, maxAttempts: 5, nextAttemptAt: null, lastError: "QBO rejected write: duplicate DocNumber", receivedAt: "2026-06-25 14:02:05Z", correlationId: "cor_b21f" },
  { id: "evt_3b7de0a1", eventId: "evt_3b7de0a1", source: "internal", entityType: "invoice", externalId: "INV-20295", operation: "create", status: "processing", attempts: 1, maxAttempts: 5, nextAttemptAt: null, lastError: null, receivedAt: "2026-06-25 14:02:09Z", correlationId: "cor_c93a" },
  { id: "evt_c40f2287", eventId: "evt_c40f2287", source: "qbo", entityType: "invoice", externalId: "QBO-5584", operation: "update", status: "done", attempts: 1, maxAttempts: 5, nextAttemptAt: null, lastError: null, receivedAt: "2026-06-25 14:01:58Z", correlationId: "cor_1d77" },
  { id: "evt_77a1be33", eventId: "evt_77a1be33", source: "internal", entityType: "invoice", externalId: "INV-20291", operation: "create", status: "dead", attempts: 3, maxAttempts: 3, nextAttemptAt: null, lastError: "QBO 500 — service unavailable", receivedAt: "2026-06-25 14:01:33Z", correlationId: "cor_4ab0" },
  { id: "evt_91c0fa2e", eventId: "evt_91c0fa2e", source: "internal", entityType: "invoice", externalId: "INV-20290", operation: "update", status: "done", attempts: 4, maxAttempts: 5, nextAttemptAt: null, lastError: null, receivedAt: "2026-06-25 14:00:08Z", correlationId: "cor_77f2" },
  { id: "evt_2d8e0b71", eventId: "evt_2d8e0b71", source: "qbo", entityType: "payment", externalId: "QBO-P88", operation: "create", status: "done", attempts: 1, maxAttempts: 5, nextAttemptAt: null, lastError: null, receivedAt: "2026-06-25 13:59:55Z", correlationId: "cor_0e51" },
  { id: "evt_5af3c920", eventId: "evt_5af3c920", source: "internal", entityType: "invoice", externalId: "INV-20288", operation: "update", status: "done", attempts: 1, maxAttempts: 5, nextAttemptAt: null, lastError: "Skipped (duplicate): idempotency key seen", receivedAt: "2026-06-25 13:59:31Z", correlationId: "cor_9b3c" },
  { id: "evt_0b6612da", eventId: "evt_0b6612da", source: "internal", entityType: "invoice", externalId: "INV-20287", operation: "create", status: "pending", attempts: 0, maxAttempts: 5, nextAttemptAt: "2026-06-25 14:02:20Z", lastError: null, receivedAt: "2026-06-25 13:59:02Z", correlationId: "cor_aa10" },
  { id: "evt_99ee88dd", eventId: "evt_99ee88dd", source: "internal", entityType: "invoice", externalId: "INV-20254", operation: "update", status: "dead", attempts: 4, maxAttempts: 4, nextAttemptAt: null, lastError: "QBO 429 — rate limited", receivedAt: "2026-06-25 13:24:00Z", correlationId: "cor_5577" },
];

const eventDetail: Record<string, EventDetailExtra> = {
  evt_8f2a91c4: {
    payload: { id: "evt_8f2a91c4", source: "internal", entity: "invoice", op: "update", docNumber: "INV-20294", total: 12480.0, currency: "USD", lines: [{ id: 3, amount: 180.0 }], emittedAt: "2026-06-25T14:02:05Z" },
    auditTrail: [
      { ts: "2026-06-25 14:02:05Z", action: "create", result: "ok", detail: "Event received from internal invoicing (webhook v2)" },
      { ts: "2026-06-25 14:02:07Z", action: "update", result: "error", detail: "POST /v3/.../invoice — attempt 1" },
      { ts: "2026-06-25 14:02:08Z", action: "error", result: "error", detail: "QBO 6140 — Duplicate Document Number" },
      { ts: "2026-06-25 14:02:11Z", action: "conflict", result: "ok", detail: "Conflict opened — amount mismatch, awaiting operator" },
    ],
  },
};

const audit: AuditEntryDto[] = [
  { id: "au_5012", eventId: "evt_8f2a91c4", entityType: "invoice", action: "conflict", before: "12480.00", after: "12300.00", result: "ok", error: null, correlationId: "cor_b21f", ts: "2026-06-25 14:02:11Z" },
  { id: "au_5011", eventId: "evt_5af3c920", entityType: "invoice", action: "skip", before: null, after: null, result: "ok", error: null, correlationId: "cor_9b3c", ts: "2026-06-25 13:59:31Z" },
  { id: "au_5010", eventId: "evt_77a1be33", entityType: "invoice", action: "error", before: null, after: null, result: "error", error: "QBO 500 — service unavailable", correlationId: "cor_4ab0", ts: "2026-06-25 14:01:40Z" },
  { id: "au_5009", eventId: "evt_91c0fa2e", entityType: "invoice", action: "conflict_resolved", before: "qbo", after: "internal", result: "ok", error: null, correlationId: "cor_77f2", ts: "2026-06-25 13:58:40Z" },
  { id: "au_5008", eventId: "evt_c40f2287", entityType: "invoice", action: "update", before: "84100.00", after: "84205.18", result: "ok", error: null, correlationId: "cor_1d77", ts: "2026-06-25 14:01:58Z" },
  { id: "au_5007", eventId: "evt_2d8e0b71", entityType: "payment", action: "create", before: null, after: "310.75", result: "ok", error: null, correlationId: "cor_0e51", ts: "2026-06-25 13:59:55Z" },
];

export const fixtures: Fixtures = {
  NOW,
  status,
  links,
  linkDetail,
  conflicts,
  conflictDetail,
  events,
  eventDetail,
  audit,
};
