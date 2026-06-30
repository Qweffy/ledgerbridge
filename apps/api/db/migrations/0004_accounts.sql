ALTER TYPE "internal"."entity" ADD VALUE 'account';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "internal"."accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"acct_type" text NOT NULL,
	"acct_num" text,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_name_unique" UNIQUE("name")
);
