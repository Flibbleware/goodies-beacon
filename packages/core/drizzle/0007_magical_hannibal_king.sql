CREATE TABLE "wish_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"category" text NOT NULL,
	"search_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wish_items_category" CHECK ("wish_items"."category" in ('game', 'dvd', 'vhs', 'toy', 'other'))
);
