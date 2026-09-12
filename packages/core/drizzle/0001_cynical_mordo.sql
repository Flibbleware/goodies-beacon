CREATE TABLE "process_heartbeat" (
	"role" text PRIMARY KEY NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
