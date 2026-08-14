CREATE TYPE "public"."credit_transaction_kind" AS ENUM('grant', 'spend', 'refund', 'expiry');--> statement-breakpoint
CREATE TYPE "public"."data_source_status" AS ENUM('licence_review_pending', 'pending', 'indexing', 'indexed', 'failed', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."data_source_type" AS ENUM('wiki', 'pdf', 'text');--> statement-breakpoint
CREATE TYPE "public"."image_feature" AS ENUM('portrait', 'variants', 'scene');--> statement-breakpoint
CREATE TYPE "public"."import_job_status" AS ENUM('queued', 'running', 'finished', 'stopped_at_ceiling', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('image', 'audio');--> statement-breakpoint
CREATE TYPE "public"."proposal_kind" AS ENUM('create', 'update', 'relation', 'draft_entity');--> statement-breakpoint
CREATE TYPE "public"."proposal_outcome" AS ENUM('pending', 'accepted', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."proposal_plan_status" AS ENUM('planning', 'ready', 'spent', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."proposal_trigger" AS ENUM('save', 'complete', 'audit', 'import', 'table');--> statement-breakpoint
CREATE TYPE "public"."revelation_kind" AS ENUM('entity', 'fact', 'relation');--> statement-breakpoint
CREATE TYPE "public"."warm_artifact_kind" AS ENUM('brief', 'npc_draft', 'ambient_pack', 'portrait', 'context_pack');--> statement-breakpoint
CREATE TYPE "public"."work_node_kind" AS ENUM('act', 'chapter', 'scene', 'encounter');--> statement-breakpoint
CREATE TYPE "public"."work_status" AS ENUM('planning', 'running', 'finished', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."work_type" AS ENUM('oneshot', 'module', 'campaign', 'story', 'novel');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" uuid NOT NULL,
	"plan_id" uuid,
	"trigger" "proposal_trigger" NOT NULL,
	"kind" "proposal_kind" NOT NULL,
	"target_entity_id" uuid,
	"relation_type_id" uuid,
	"related_entity_id" uuid,
	"patch" jsonb NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	"provider" text,
	"model_id" text,
	"credits" numeric(12, 4) DEFAULT 0 NOT NULL,
	"outcome" "proposal_outcome" DEFAULT 'pending' NOT NULL,
	"reject_reason" text,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"applied_revision_id" uuid,
	"author_kind" "author_kind" DEFAULT 'ai_accepted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" uuid NOT NULL,
	"trigger" "proposal_trigger" NOT NULL,
	"trigger_entity_id" uuid,
	"trigger_revision_id" uuid,
	"summary" text DEFAULT '' NOT NULL,
	"status" "proposal_plan_status" DEFAULT 'planning' NOT NULL,
	"estimated_credits" numeric(12, 4) DEFAULT 0 NOT NULL,
	"candidate_cap" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" uuid NOT NULL,
	"type" "work_type" NOT NULL,
	"status" "work_status" DEFAULT 'planning' NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_node" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"parent_id" uuid,
	"kind" "work_node_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_node_entity" (
	"node_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_node_entity_node_id_entity_id_pk" PRIMARY KEY("node_id","entity_id")
);
--> statement-breakpoint
CREATE TABLE "revelation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" uuid NOT NULL,
	"kind" "revelation_kind" NOT NULL,
	"entity_id" uuid,
	"fact_id" uuid,
	"relation_id" uuid,
	"session_entity_id" uuid,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" uuid NOT NULL,
	"place_entity_id" uuid,
	"session_entity_id" uuid,
	"moment" text DEFAULT '' NOT NULL,
	"situation" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "warm_artifact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" uuid NOT NULL,
	"kind" "warm_artifact_kind" NOT NULL,
	"subject_entity_id" uuid,
	"payload" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"credits" numeric(12, 4) DEFAULT 0 NOT NULL,
	"consumed_count" integer DEFAULT 0 NOT NULL,
	"last_consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_model_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature" "image_feature" NOT NULL,
	"provider" text DEFAULT 'replicate' NOT NULL,
	"model_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_style" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" uuid,
	"name" text NOT NULL,
	"prompt_modifier" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" uuid NOT NULL,
	"entity_id" uuid,
	"kind" "media_kind" NOT NULL,
	"path" text NOT NULL,
	"mime_type" text NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"prompt" text,
	"provider" text,
	"model_id" text,
	"generated" boolean DEFAULT false NOT NULL,
	"published_to_players" boolean DEFAULT false NOT NULL,
	"similarity_key" text,
	"credits" numeric(12, 4) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" uuid,
	"type" "data_source_type" NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "data_source_status" DEFAULT 'pending' NOT NULL,
	"licence" text,
	"licence_url" text,
	"licence_reviewed_at" timestamp with time zone,
	"licence_reviewed_by" text,
	"licence_notes" text DEFAULT '' NOT NULL,
	"attribution" text DEFAULT '' NOT NULL,
	"last_indexed_at" timestamp with time zone,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_source_exclusion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source_id" uuid,
	"url_pattern" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"requested_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_source_ref" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"source_system" text NOT NULL,
	"external_id" text,
	"source_url" text,
	"content_hash" text NOT NULL,
	"missing_in_source" boolean DEFAULT false NOT NULL,
	"last_import_job_id" uuid,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" uuid NOT NULL,
	"created_by" text,
	"source_type" text NOT NULL,
	"playbook" text NOT NULL,
	"playbook_version" integer NOT NULL,
	"artefact_path" text NOT NULL,
	"artefact_bytes" integer DEFAULT 0 NOT NULL,
	"artefact_sha256" text NOT NULL,
	"document_count" integer DEFAULT 0 NOT NULL,
	"budget_credits" numeric(12, 4) DEFAULT 0 NOT NULL,
	"spent_credits" numeric(12, 4) DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "import_job_status" DEFAULT 'queued' NOT NULL,
	"outcome_note" text DEFAULT '' NOT NULL,
	"proposals_emitted" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supersede" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"data_source_id" uuid NOT NULL,
	"source_url" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "byo_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"ciphertext" text NOT NULL,
	"last_four" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "credit_transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"universe_id" uuid,
	"kind" "credit_transaction_kind" NOT NULL,
	"credits" numeric(12, 4) NOT NULL,
	"operation" text,
	"model_call_id" uuid,
	"idempotency_key" text,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_billing" (
	"user_id" text PRIMARY KEY NOT NULL,
	"subscription_credits" numeric(12, 4) DEFAULT 0 NOT NULL,
	"purchased_credits" numeric(12, 4) DEFAULT 0 NOT NULL,
	"warm_budget_credits" numeric(12, 4) DEFAULT 0 NOT NULL,
	"warm_budget_spent" numeric(12, 4) DEFAULT 0 NOT NULL,
	"period_start" timestamp with time zone DEFAULT now() NOT NULL,
	"period_end" timestamp with time zone,
	"plan" text DEFAULT 'free' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_universe_id_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_plan_id_proposal_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."proposal_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_target_entity_id_entity_id_fk" FOREIGN KEY ("target_entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_relation_type_id_relation_type_id_fk" FOREIGN KEY ("relation_type_id") REFERENCES "public"."relation_type"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_related_entity_id_entity_id_fk" FOREIGN KEY ("related_entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_applied_revision_id_revision_id_fk" FOREIGN KEY ("applied_revision_id") REFERENCES "public"."revision"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_plan" ADD CONSTRAINT "proposal_plan_universe_id_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_plan" ADD CONSTRAINT "proposal_plan_trigger_entity_id_entity_id_fk" FOREIGN KEY ("trigger_entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_plan" ADD CONSTRAINT "proposal_plan_trigger_revision_id_revision_id_fk" FOREIGN KEY ("trigger_revision_id") REFERENCES "public"."revision"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work" ADD CONSTRAINT "work_universe_id_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_node" ADD CONSTRAINT "work_node_work_id_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_node_entity" ADD CONSTRAINT "work_node_entity_node_id_work_node_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."work_node"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_node_entity" ADD CONSTRAINT "work_node_entity_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revelation" ADD CONSTRAINT "revelation_universe_id_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revelation" ADD CONSTRAINT "revelation_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revelation" ADD CONSTRAINT "revelation_fact_id_fact_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."fact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revelation" ADD CONSTRAINT "revelation_relation_id_relation_id_fk" FOREIGN KEY ("relation_id") REFERENCES "public"."relation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revelation" ADD CONSTRAINT "revelation_session_entity_id_entity_id_fk" FOREIGN KEY ("session_entity_id") REFERENCES "public"."entity"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revelation" ADD CONSTRAINT "revelation_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_context" ADD CONSTRAINT "session_context_universe_id_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_context" ADD CONSTRAINT "session_context_place_entity_id_entity_id_fk" FOREIGN KEY ("place_entity_id") REFERENCES "public"."entity"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_context" ADD CONSTRAINT "session_context_session_entity_id_entity_id_fk" FOREIGN KEY ("session_entity_id") REFERENCES "public"."entity"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warm_artifact" ADD CONSTRAINT "warm_artifact_universe_id_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warm_artifact" ADD CONSTRAINT "warm_artifact_subject_entity_id_entity_id_fk" FOREIGN KEY ("subject_entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_style" ADD CONSTRAINT "image_style_universe_id_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_universe_id_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_source" ADD CONSTRAINT "data_source_universe_id_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_source" ADD CONSTRAINT "data_source_licence_reviewed_by_user_id_fk" FOREIGN KEY ("licence_reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_source_exclusion" ADD CONSTRAINT "data_source_exclusion_data_source_id_data_source_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_source_ref" ADD CONSTRAINT "entity_source_ref_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_source_ref" ADD CONSTRAINT "entity_source_ref_last_import_job_id_import_job_id_fk" FOREIGN KEY ("last_import_job_id") REFERENCES "public"."import_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_universe_id_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supersede" ADD CONSTRAINT "supersede_universe_id_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supersede" ADD CONSTRAINT "supersede_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supersede" ADD CONSTRAINT "supersede_data_source_id_data_source_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byo_key" ADD CONSTRAINT "byo_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transaction" ADD CONSTRAINT "credit_transaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transaction" ADD CONSTRAINT "credit_transaction_universe_id_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universe"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transaction" ADD CONSTRAINT "credit_transaction_model_call_id_model_call_id_fk" FOREIGN KEY ("model_call_id") REFERENCES "public"."model_call"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_billing" ADD CONSTRAINT "user_billing_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_key" ON "session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "proposal_universe_outcome_idx" ON "proposal" USING btree ("universe_id","outcome","created_at");--> statement-breakpoint
CREATE INDEX "proposal_plan_rank_idx" ON "proposal" USING btree ("plan_id","rank");--> statement-breakpoint
CREATE INDEX "proposal_target_idx" ON "proposal" USING btree ("target_entity_id");--> statement-breakpoint
CREATE INDEX "proposal_outcome_decided_idx" ON "proposal" USING btree ("outcome","decided_at") WHERE "proposal"."decided_at" is not null;--> statement-breakpoint
CREATE INDEX "proposal_plan_universe_created_idx" ON "proposal_plan" USING btree ("universe_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "work_universe_slug_key" ON "work" USING btree ("universe_id","slug");--> statement-breakpoint
CREATE INDEX "work_node_work_parent_idx" ON "work_node" USING btree ("work_id","parent_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "work_node_sibling_position_key" ON "work_node" USING btree ("work_id","parent_id","position");--> statement-breakpoint
CREATE INDEX "work_node_entity_entity_idx" ON "work_node_entity" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "revelation_universe_idx" ON "revelation" USING btree ("universe_id","created_at");--> statement-breakpoint
CREATE INDEX "revelation_session_idx" ON "revelation" USING btree ("session_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "revelation_entity_session_key" ON "revelation" USING btree ("entity_id","session_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "revelation_fact_session_key" ON "revelation" USING btree ("fact_id","session_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "revelation_relation_session_key" ON "revelation" USING btree ("relation_id","session_entity_id");--> statement-breakpoint
CREATE INDEX "session_context_universe_started_idx" ON "session_context" USING btree ("universe_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "session_context_running_key" ON "session_context" USING btree ("universe_id") WHERE ended_at is null;--> statement-breakpoint
CREATE INDEX "warm_artifact_lookup_idx" ON "warm_artifact" USING btree ("universe_id","kind","subject_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "warm_artifact_fingerprint_key" ON "warm_artifact" USING btree ("kind","subject_entity_id","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "image_model_active_feature_key" ON "image_model_config" USING btree ("feature") WHERE "image_model_config"."active" = true;--> statement-breakpoint
CREATE INDEX "image_style_universe_idx" ON "image_style" USING btree ("universe_id");--> statement-breakpoint
CREATE INDEX "media_asset_entity_idx" ON "media_asset" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "media_asset_universe_kind_idx" ON "media_asset" USING btree ("universe_id","kind");--> statement-breakpoint
CREATE INDEX "media_asset_similarity_idx" ON "media_asset" USING btree ("similarity_key");--> statement-breakpoint
CREATE INDEX "data_source_universe_idx" ON "data_source" USING btree ("universe_id","status");--> statement-breakpoint
CREATE INDEX "data_source_exclusion_source_idx" ON "data_source_exclusion" USING btree ("data_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_source_ref_external_key" ON "entity_source_ref" USING btree ("source_system","external_id");--> statement-breakpoint
CREATE INDEX "entity_source_ref_entity_idx" ON "entity_source_ref" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "import_job_universe_created_idx" ON "import_job" USING btree ("universe_id","created_at");--> statement-breakpoint
CREATE INDEX "import_job_status_idx" ON "import_job" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "supersede_universe_url_key" ON "supersede" USING btree ("universe_id","source_url");--> statement-breakpoint
CREATE UNIQUE INDEX "byo_key_user_provider_key" ON "byo_key" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "credit_transaction_user_created_idx" ON "credit_transaction" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_transaction_idempotency_key" ON "credit_transaction" USING btree ("kind","idempotency_key") WHERE "credit_transaction"."idempotency_key" is not null;