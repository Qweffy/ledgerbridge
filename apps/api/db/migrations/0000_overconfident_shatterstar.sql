CREATE TYPE "public"."audit_action" AS ENUM('create', 'update', 'void', 'delete', 'skip', 'conflict', 'conflict_resolved', 'error');--> statement-breakpoint
CREATE TYPE "public"."audit_result" AS ENUM('ok', 'error');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('invoice', 'payment', 'account');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('pending', 'processing', 'done', 'dead');--> statement-breakpoint
CREATE TYPE "public"."link_status" AS ENUM('linked', 'conflict', 'error', 'skip');--> statement-breakpoint
CREATE TYPE "public"."system_id" AS ENUM('internal', 'quickbooks');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" text,
	"entity_type" "entity_type",
	"entity_external_id" text,
	"action" "audit_action" NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"result" "audit_result" NOT NULL,
	"error" text,
	"correlation_id" text,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "links" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"internal_id" text,
	"qbo_id" text,
	"last_synced_hash" text,
	"last_internal_version" integer,
	"last_qbo_version" integer,
	"status" "link_status" DEFAULT 'linked' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_tokens" (
	"realm_id" text PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"source" "system_id" NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"entity_external_id" text NOT NULL,
	"status" "event_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"last_error" text,
	"correlation_id" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_ts_idx" ON "audit_log" USING btree ("ts");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "links_internal_uq" ON "links" USING btree ("entity_type","internal_id") WHERE "links"."internal_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "links_qbo_uq" ON "links" USING btree ("entity_type","qbo_id") WHERE "links"."qbo_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sync_events_event_id_uq" ON "sync_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_events_due_idx" ON "sync_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE VIEW "public"."dead_letter" AS (select "id", "event_id", "source", "entity_type", "entity_external_id", "status", "attempts", "payload", "last_error", "correlation_id", "next_attempt_at", "locked_at", "locked_by", "received_at", "processed_at" from "sync_events" where "sync_events"."status" = 'dead');