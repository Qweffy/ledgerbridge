// LedgerBridge — Drizzle schema (Postgres).
// Core sync tables to define (see DESIGN.md → "Modelo de datos"):
//   links        internal_id ↔ qbo_id mapping per entity (+ last-synced version/hash, status)
//   sync_events  inbox/outbox: event_id UNIQUE (= idempotency), source, status, attempts, payload
//   audit_log    what changed · action taken · before/after · result · error
// Plus link rows for payments and GL accounts (reuse the same `links` table with entity_type, or split).
//
// db/index.ts does `import * as schema from './schema'`, so an empty schema is valid until you add tables.

export {};
