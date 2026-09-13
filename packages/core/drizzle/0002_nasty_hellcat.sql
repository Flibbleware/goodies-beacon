CREATE TABLE "candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wanted_item_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"spec_version_id" uuid NOT NULL,
	"search_plan_id" text,
	"origin" text DEFAULT 'poll' NOT NULL,
	"stage" text DEFAULT 'new' NOT NULL,
	"error" text,
	"retain" boolean DEFAULT false NOT NULL,
	"relist_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidates_origin" CHECK ("candidates"."origin" in ('poll', 'backfill', 'scan')),
	CONSTRAINT "candidates_stage" CHECK ("candidates"."stage" in ('new', 'prefiltered', 'enriched', 'reviewed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "cost_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"wanted_item_id" uuid,
	"candidate_id" uuid,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_ledger_role" CHECK ("cost_ledger"."role" in ('interviewer', 'prefilter', 'reviewer'))
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"verdict_id" uuid,
	"type" text NOT NULL,
	"note" text,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_type" CHECK ("feedback"."type" in ('not_a_match', 'challenge')),
	CONSTRAINT "feedback_resolution" CHECK ("feedback"."resolution" is null or "feedback"."resolution" in ('rereviewed', 'folded_into_spec', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "grading_scales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"grades" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instance_secret" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"seller_salt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_secret_is_singleton" CHECK ("instance_secret"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"title_en" text,
	"description" text,
	"description_en" text,
	"price_amount" numeric(12, 2),
	"price_currency" text,
	"price_gbp" numeric(12, 2),
	"price_rate_date" text,
	"buying_type" text,
	"seller_hash" text,
	"item_location_country" text,
	"ships_to_uk" text DEFAULT 'unknown' NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"listed_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_source" CHECK ("listings"."source" in ('ebay', 'vinted', 'yahoo_auctions_jp', 'mercari_jp')),
	CONSTRAINT "listings_ships_to_uk" CHECK ("listings"."ships_to_uk" in ('yes', 'no', 'unknown')),
	CONSTRAINT "listings_buying_type" CHECK ("listings"."buying_type" is null or "listings"."buying_type" in ('auction', 'fixed'))
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"path" text NOT NULL,
	"thumbnail_path" text,
	"content_hash" text NOT NULL,
	"perceptual_hash" text,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"label" text,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_kind" CHECK ("media"."kind" in ('listing', 'reference', 'grade_example'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"sent_at" timestamp with time zone,
	"digest_date" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_channel" CHECK ("notifications"."channel" in ('realtime', 'digest'))
);
--> statement-breakpoint
CREATE TABLE "search_plan_state" (
	"plan_id" text PRIMARY KEY NOT NULL,
	"wanted_item_id" uuid NOT NULL,
	"source" text NOT NULL,
	"watermark" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"candidates_found" integer DEFAULT 0 NOT NULL,
	"candidates_reviewed" integer DEFAULT 0 NOT NULL,
	"candidates_matched" integer DEFAULT 0 NOT NULL,
	"candidates_uncertain" integer DEFAULT 0 NOT NULL,
	"prefilter_cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_plan_state_source" CHECK ("search_plan_state"."source" in ('ebay', 'vinted', 'yahoo_auctions_jp', 'mercari_jp'))
);
--> statement-breakpoint
CREATE TABLE "seen" (
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seen_source_external_id_pk" PRIMARY KEY("source","external_id"),
	CONSTRAINT "seen_source" CHECK ("seen"."source" in ('ebay', 'vinted', 'yahoo_auctions_jp', 'mercari_jp'))
);
--> statement-breakpoint
CREATE TABLE "spec_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wanted_item_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"created_by" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"plausibility_note" text,
	"settings" jsonb NOT NULL,
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"search_plans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reference_images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"change_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spec_versions_created_by" CHECK ("spec_versions"."created_by" in ('interview', 'amendment', 'challenge', 'manual_edit', 'image_added')),
	CONSTRAINT "spec_versions_version_positive" CHECK ("spec_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "verdicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"spec_version_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"criteria_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"grade" text,
	"english_summary" text,
	"model_role" text,
	"model" text,
	"prompt_text" text,
	"prompt_images" jsonb,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(12, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verdicts_decision" CHECK ("verdicts"."decision" in ('match', 'uncertain', 'reject')),
	CONSTRAINT "verdicts_reason" CHECK ("verdicts"."reason" is null or "verdicts"."reason" in ('over_budget', 'negative_keyword', 'prefilter')),
	CONSTRAINT "verdicts_model_role" CHECK ("verdicts"."model_role" is null or "verdicts"."model_role" in ('interviewer', 'prefilter', 'reviewer'))
);
--> statement-breakpoint
CREATE TABLE "wanted_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notification_mode" text DEFAULT 'digest' NOT NULL,
	"poll_every" text,
	"grading_scale_id" uuid,
	"minimum_grade" text,
	"current_spec_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wanted_items_status" CHECK ("wanted_items"."status" in ('draft', 'active', 'paused', 'found', 'archived')),
	CONSTRAINT "wanted_items_notification_mode" CHECK ("wanted_items"."notification_mode" in ('realtime', 'digest'))
);
--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_wanted_item_id_wanted_items_id_fk" FOREIGN KEY ("wanted_item_id") REFERENCES "public"."wanted_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_spec_version_id_spec_versions_id_fk" FOREIGN KEY ("spec_version_id") REFERENCES "public"."spec_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_relist_of_candidates_id_fk" FOREIGN KEY ("relist_of") REFERENCES "public"."candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD CONSTRAINT "cost_ledger_wanted_item_id_wanted_items_id_fk" FOREIGN KEY ("wanted_item_id") REFERENCES "public"."wanted_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD CONSTRAINT "cost_ledger_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_verdict_id_verdicts_id_fk" FOREIGN KEY ("verdict_id") REFERENCES "public"."verdicts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_plan_state" ADD CONSTRAINT "search_plan_state_wanted_item_id_wanted_items_id_fk" FOREIGN KEY ("wanted_item_id") REFERENCES "public"."wanted_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_versions" ADD CONSTRAINT "spec_versions_wanted_item_id_wanted_items_id_fk" FOREIGN KEY ("wanted_item_id") REFERENCES "public"."wanted_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_spec_version_id_spec_versions_id_fk" FOREIGN KEY ("spec_version_id") REFERENCES "public"."spec_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wanted_items" ADD CONSTRAINT "wanted_items_grading_scale_id_grading_scales_id_fk" FOREIGN KEY ("grading_scale_id") REFERENCES "public"."grading_scales"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wanted_items" ADD CONSTRAINT "wanted_items_current_spec_version_id_spec_versions_id_fk" FOREIGN KEY ("current_spec_version_id") REFERENCES "public"."spec_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidates_item_listing_key" ON "candidates" USING btree ("wanted_item_id","listing_id");--> statement-breakpoint
CREATE INDEX "candidates_item_created_idx" ON "candidates" USING btree ("wanted_item_id","created_at");--> statement-breakpoint
CREATE INDEX "candidates_item_stage_idx" ON "candidates" USING btree ("wanted_item_id","stage");--> statement-breakpoint
CREATE INDEX "candidates_plan_idx" ON "candidates" USING btree ("search_plan_id");--> statement-breakpoint
CREATE INDEX "cost_ledger_created_idx" ON "cost_ledger" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "cost_ledger_item_idx" ON "cost_ledger" USING btree ("wanted_item_id");--> statement-breakpoint
CREATE INDEX "feedback_candidate_idx" ON "feedback" USING btree ("candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_source_external_id_key" ON "listings" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "listings_first_seen_at_idx" ON "listings" USING btree ("first_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_content_hash_key" ON "media" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_candidate_channel_key" ON "notifications" USING btree ("candidate_id","channel");--> statement-breakpoint
CREATE INDEX "search_plan_state_item_idx" ON "search_plan_state" USING btree ("wanted_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spec_versions_item_version_key" ON "spec_versions" USING btree ("wanted_item_id","version");--> statement-breakpoint
CREATE INDEX "verdicts_candidate_created_idx" ON "verdicts" USING btree ("candidate_id","created_at");--> statement-breakpoint
CREATE INDEX "verdicts_decision_idx" ON "verdicts" USING btree ("decision");--> statement-breakpoint
CREATE INDEX "wanted_items_status_idx" ON "wanted_items" USING btree ("status");