CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"level" text DEFAULT 'warning' NOT NULL,
	"dedupe_key" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_kind" CHECK ("events"."kind" in ('budget_exceeded')),
	CONSTRAINT "events_level" CHECK ("events"."level" in ('info', 'warning', 'error'))
);
--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD COLUMN "cache_read_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD COLUMN "cache_write_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD COLUMN "cost_known" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "events_kind_dedupe_key" ON "events" USING btree ("kind","dedupe_key");--> statement-breakpoint
CREATE INDEX "events_created_idx" ON "events" USING btree ("created_at");