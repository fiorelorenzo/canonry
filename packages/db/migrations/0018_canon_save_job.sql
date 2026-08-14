CREATE TYPE "public"."canon_save_job_status" AS ENUM('pending', 'claimed', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "canon_save_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_name" text NOT NULL,
	"user_id" text NOT NULL,
	"old_body" text NOT NULL,
	"new_body" text NOT NULL,
	"trigger_revision_id" uuid,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "canon_save_job_status" DEFAULT 'pending' NOT NULL,
	"lease_holder" text,
	"lease_expires_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"propagation_outcome" jsonb,
	"audit_outcome" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "canon_save_job" ADD CONSTRAINT "canon_save_job_universe_id_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canon_save_job" ADD CONSTRAINT "canon_save_job_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canon_save_job" ADD CONSTRAINT "canon_save_job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canon_save_job" ADD CONSTRAINT "canon_save_job_trigger_revision_id_revision_id_fk" FOREIGN KEY ("trigger_revision_id") REFERENCES "public"."revision"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "canon_save_job_pending_key" ON "canon_save_job" USING btree ("universe_id","entity_id") WHERE "canon_save_job"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "canon_save_job_claim_idx" ON "canon_save_job" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "canon_save_job_lease_idx" ON "canon_save_job" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "canon_save_job_finished_idx" ON "canon_save_job" USING btree ("finished_at");