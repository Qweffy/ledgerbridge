CREATE SCHEMA "internal";
--> statement-breakpoint
CREATE TYPE "internal"."change_type" AS ENUM('create', 'update', 'pay', 'delete');--> statement-breakpoint
CREATE TYPE "internal"."entity" AS ENUM('invoice', 'payment');--> statement-breakpoint
CREATE TYPE "internal"."invoice_status" AS ENUM('open', 'partially_paid', 'paid', 'deleted');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "internal"."changes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity" "internal"."entity" NOT NULL,
	"entity_id" text NOT NULL,
	"change_type" "internal"."change_type" NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"delivered" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "internal"."invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"doc_number" text NOT NULL,
	"customer_name" text NOT NULL,
	"status" "internal"."invoice_status" DEFAULT 'open' NOT NULL,
	"amount_cents" integer NOT NULL,
	"balance_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "internal"."payments" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "internal"."payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "internal"."invoices"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
