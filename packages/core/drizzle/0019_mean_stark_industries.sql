ALTER TABLE "listings" ADD COLUMN "availability" text DEFAULT 'available' NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "availability_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "unavailable_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_availability" CHECK ("listings"."availability" in ('available', 'sold', 'ended'));