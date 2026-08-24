CREATE TYPE "public"."universe_index_backfill_status" AS ENUM('pending', 'claimed', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "universe_index_backfill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" "universe_index_backfill_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_holder" text,
	"lease_expires_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"entities_total" integer,
	"entities_missing" integer,
	"entities_scheduled" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "universe_index_backfill" ADD CONSTRAINT "universe_index_backfill_universe_id_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "universe_index_backfill_active_key" ON "universe_index_backfill" USING btree ("universe_id") WHERE "universe_index_backfill"."status" in ('pending', 'claimed');--> statement-breakpoint
CREATE INDEX "universe_index_backfill_claim_idx" ON "universe_index_backfill" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "universe_index_backfill_lease_idx" ON "universe_index_backfill" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "universe_index_backfill_universe_idx" ON "universe_index_backfill" USING btree ("universe_id","requested_at");--> statement-breakpoint
CREATE INDEX "canon_save_job_no_embedding_model_idx" ON "canon_save_job" USING btree ("universe_id","finished_at") WHERE "canon_save_job"."index_outcome"->>'status' = 'no-embedding-model';