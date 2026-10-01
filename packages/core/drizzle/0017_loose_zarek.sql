ALTER TABLE "verdicts" DROP CONSTRAINT "verdicts_reason";--> statement-breakpoint
ALTER TABLE "wanted_items" ADD COLUMN "match_notifications" text DEFAULT 'digest' NOT NULL;--> statement-breakpoint
ALTER TABLE "wanted_items" ADD COLUMN "uncertain_notifications" text DEFAULT 'digest' NOT NULL;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_reason" CHECK ("verdicts"."reason" is null or "verdicts"."reason" in ('over_budget', 'under_minimum', 'negative_keyword', 'excluded_location', 'prefilter'));--> statement-breakpoint
ALTER TABLE "wanted_items" ADD CONSTRAINT "wanted_items_match_notifications" CHECK ("wanted_items"."match_notifications" in ('email', 'digest', 'none'));--> statement-breakpoint
ALTER TABLE "wanted_items" ADD CONSTRAINT "wanted_items_uncertain_notifications" CHECK ("wanted_items"."uncertain_notifications" in ('email', 'digest', 'none'));--> statement-breakpoint
UPDATE "wanted_items" SET "match_notifications" = CASE "notification_mode" WHEN 'realtime' THEN 'email' ELSE 'digest' END, "uncertain_notifications" = CASE "notification_mode" WHEN 'realtime' THEN 'email' ELSE 'digest' END;
