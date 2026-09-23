CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"icon" text NOT NULL,
	"colour" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_icon" CHECK ("categories"."icon" in ('gamepad', 'disc', 'cassette', 'robot', 'figurine', 'book', 'star', 'heart', 'box', 'music', 'camera', 'monitor', 'gem', 'trophy', 'tag', 'coin', 'shirt')),
	CONSTRAINT "categories_colour" CHECK ("categories"."colour" in ('violet', 'indigo', 'blue', 'cyan', 'teal', 'green', 'amber', 'orange', 'copper', 'pink', 'fuchsia', 'slate'))
);
--> statement-breakpoint
ALTER TABLE "wanted_items" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "wish_items" ADD COLUMN "category_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_idx" ON "categories" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "wanted_items" ADD CONSTRAINT "wanted_items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_items" ADD CONSTRAINT "wish_items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- P1-22: the seven built-in categories become the owner's own. Each one in use by a wish or a
-- wanted item becomes a row with the icon and colour it was drawn with, and those rows point at it;
-- one nothing uses is not created. Other was the fallback for "none of these", so it becomes no
-- category rather than a category called Other.
INSERT INTO "categories" ("name", "icon", "colour")
SELECT "legacy"."name", "legacy"."icon", "legacy"."colour"
FROM (VALUES
	('game', 'Game', 'gamepad', 'violet'),
	('dvd', 'DVD', 'disc', 'teal'),
	('vhs', 'VHS', 'cassette', 'blue'),
	('toy', 'Toy', 'robot', 'pink'),
	('figurine', 'Figurine', 'figurine', 'copper'),
	('book', 'Book', 'book', 'orange')
) AS "legacy" ("key", "name", "icon", "colour")
WHERE EXISTS (SELECT 1 FROM "wish_items" WHERE "category" = "legacy"."key")
	OR EXISTS (SELECT 1 FROM "wanted_items" WHERE "category" = "legacy"."key");--> statement-breakpoint
UPDATE "wish_items" SET "category_id" = "categories"."id"
FROM "categories"
WHERE lower("categories"."name") = "wish_items"."category";--> statement-breakpoint
UPDATE "wanted_items" SET "category_id" = "categories"."id"
FROM "categories"
WHERE lower("categories"."name") = "wanted_items"."category";
