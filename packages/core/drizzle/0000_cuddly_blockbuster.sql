CREATE TABLE "auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_user_is_singleton" CHECK ("auth_user"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_is_singleton" CHECK ("settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_session_expires_at_idx" ON "auth_session" USING btree ("expires_at");