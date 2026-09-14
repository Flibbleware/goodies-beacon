CREATE TABLE "fx_rates" (
	"currency" text NOT NULL,
	"rate_date" text NOT NULL,
	"units_per_gbp" numeric(18, 8) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_currency_rate_date_pk" PRIMARY KEY("currency","rate_date")
);
--> statement-breakpoint
CREATE INDEX "fx_rates_currency_date_idx" ON "fx_rates" USING btree ("currency","rate_date");