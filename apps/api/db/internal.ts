// Simulated "internal" invoicing system — the other side of the bridge.
// Lives in its own Postgres schema so it's clearly not part of LedgerBridge's
// own sync tables. It owns real invoice/payment data (money in integer cents),
// and every mutation appends to `internal.changes` (its change feed / outbox),
// which the system turns into an HMAC-signed webhook to the bridge.

import {
  bigserial,
  boolean,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const internalSchema = pgSchema("internal");

export const internalInvoiceStatus = internalSchema.enum("invoice_status", [
  "open",
  "partially_paid",
  "paid",
  "deleted",
]);
export const internalChangeType = internalSchema.enum("change_type", [
  "create",
  "update",
  "pay",
  "delete",
]);
export const internalEntity = internalSchema.enum("entity", ["invoice", "payment", "account"]);

export const internalInvoices = internalSchema.table("invoices", {
  id: text("id").primaryKey(),
  docNumber: text("doc_number").notNull(),
  customerName: text("customer_name").notNull(),
  status: internalInvoiceStatus("status").notNull().default("open"),
  amountCents: integer("amount_cents").notNull(),
  balanceCents: integer("balance_cents").notNull(),
  currency: text("currency").notNull().default("USD"),
  version: integer("version").notNull().default(1),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

// Chart of accounts (GL accounts) the internal system owns. Each is pushed to a
// QBO Account; Name is unique, which is the external-id key for idempotent
// check-before-create (the account analogue of an invoice's DocNumber).
export const internalAccounts = internalSchema.table("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  acctType: text("acct_type").notNull(),
  acctNum: text("acct_num"),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const internalPayments = internalSchema.table("payments", {
  id: text("id").primaryKey(),
  invoiceId: text("invoice_id")
    .notNull()
    .references(() => internalInvoices.id),
  amountCents: integer("amount_cents").notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Append-only change feed. Each row becomes one signed webhook ("a ping"); the
// bridge refetches the full entity rather than trusting the payload.
export const internalChanges = internalSchema.table("changes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  entity: internalEntity("entity").notNull(),
  entityId: text("entity_id").notNull(),
  changeType: internalChangeType("change_type").notNull(),
  version: integer("version").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  delivered: boolean("delivered").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
