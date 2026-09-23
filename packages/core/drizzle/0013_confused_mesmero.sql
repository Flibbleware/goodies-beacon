ALTER TABLE "wanted_items" DROP CONSTRAINT "wanted_items_category";--> statement-breakpoint
ALTER TABLE "wish_items" DROP CONSTRAINT "wish_items_category";--> statement-breakpoint
ALTER TABLE "wanted_items" DROP COLUMN "category";--> statement-breakpoint
ALTER TABLE "wish_items" DROP COLUMN "category";