CREATE TABLE "shared_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"text" text NOT NULL,
	"kind" text,
	"quantifiable" boolean,
	"on_unknown" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_criteria_kind" CHECK ("shared_criteria"."kind" in ('hard', 'soft')),
	CONSTRAINT "shared_criteria_on_unknown" CHECK ("shared_criteria"."on_unknown" in ('surface', 'reject'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "shared_criteria_key_idx" ON "shared_criteria" USING btree ("key");