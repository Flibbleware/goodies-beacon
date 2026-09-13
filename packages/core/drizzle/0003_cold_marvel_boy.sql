CREATE TABLE "source_cookies" (
	"source" text NOT NULL,
	"domain" text NOT NULL,
	"name" text NOT NULL,
	"value" text NOT NULL,
	"path" text DEFAULT '/' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_cookies_source_domain_name_pk" PRIMARY KEY("source","domain","name"),
	CONSTRAINT "source_cookies_source" CHECK ("source_cookies"."source" in ('ebay', 'vinted', 'yahoo_auctions_jp', 'mercari_jp', '_template'))
);
--> statement-breakpoint
ALTER TABLE "listings" DROP CONSTRAINT "listings_source";--> statement-breakpoint
ALTER TABLE "search_plan_state" DROP CONSTRAINT "search_plan_state_source";--> statement-breakpoint
ALTER TABLE "seen" DROP CONSTRAINT "seen_source";--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_source" CHECK ("listings"."source" in ('ebay', 'vinted', 'yahoo_auctions_jp', 'mercari_jp', '_template'));--> statement-breakpoint
ALTER TABLE "search_plan_state" ADD CONSTRAINT "search_plan_state_source" CHECK ("search_plan_state"."source" in ('ebay', 'vinted', 'yahoo_auctions_jp', 'mercari_jp', '_template'));--> statement-breakpoint
ALTER TABLE "seen" ADD CONSTRAINT "seen_source" CHECK ("seen"."source" in ('ebay', 'vinted', 'yahoo_auctions_jp', 'mercari_jp', '_template'));