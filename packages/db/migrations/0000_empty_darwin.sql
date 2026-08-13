CREATE TYPE "public"."author_kind" AS ENUM('human', 'ai_accepted');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('character', 'place', 'faction', 'item', 'event', 'session');--> statement-breakpoint
CREATE TYPE "public"."entity_visibility" AS ENUM('gm_only', 'revealable');--> statement-breakpoint
CREATE TYPE "public"."model_call_agent" AS ENUM('loremaster', 'propagate', 'warm', 'indexing');--> statement-breakpoint
CREATE TYPE "public"."model_purpose" AS ENUM('cheap', 'premium', 'multimodal', 'embedding', 'image');--> statement-breakpoint
CREATE TYPE "public"."relation_cardinality" AS ENUM('one_to_one', 'one_to_many', 'many_to_one', 'many_to_many');--> statement-breakpoint
CREATE TYPE "public"."universe_kind" AS ENUM('homebrew', 'derived');--> statement-breakpoint
CREATE TYPE "public"."universe_member_role" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TABLE "universe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" "universe_kind" NOT NULL,
	"base_universe_id" uuid,
	"image_style_id" uuid,
	"loremaster_description" text DEFAULT '' NOT NULL,
	"ai_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "universe_derived_has_base" CHECK (("universe"."kind" = 'derived' and "universe"."base_universe_id" is not null) or ("universe"."kind" = 'homebrew' and "universe"."base_universe_id" is null))
);
--> statement-breakpoint
CREATE TABLE "universe_member" (
	"universe_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "universe_member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "universe_member_universe_id_user_id_pk" PRIMARY KEY("universe_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "entity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" uuid NOT NULL,
	"type" "entity_type" NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"visibility" "entity_visibility" DEFAULT 'revealable' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" uuid NOT NULL,
	"relation_type_id" uuid NOT NULL,
	"from_entity_id" uuid NOT NULL,
	"to_entity_id" uuid NOT NULL,
	"author_kind" "author_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relation_from_ne_to" CHECK ("relation"."from_entity_id" <> "relation"."to_entity_id")
);
--> statement-breakpoint
CREATE TABLE "relation_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" uuid,
	"label" text NOT NULL,
	"inverse_label" text NOT NULL,
	"cardinality" "relation_cardinality" NOT NULL,
	"allowed_from" "entity_type"[] NOT NULL,
	"allowed_to" "entity_type"[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"parent_revision_id" uuid,
	"author_kind" "author_kind" NOT NULL,
	"author_user_id" text,
	"proposal_id" uuid,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"statement" text NOT NULL,
	"source_revision_id" uuid NOT NULL,
	"span_start" integer NOT NULL,
	"span_end" integer NOT NULL,
	"author_kind" "author_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fact_span_valid" CHECK ("fact"."span_end" > "fact"."span_start")
);
--> statement-breakpoint
CREATE TABLE "model_call" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"universe_id" uuid,
	"agent" "model_call_agent" NOT NULL,
	"operation" text NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"embedding_tokens" integer DEFAULT 0 NOT NULL,
	"credits" numeric(12, 4) DEFAULT 0 NOT NULL,
	"cost_eur" numeric(12, 6) DEFAULT 0 NOT NULL,
	"latency_ms" integer NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" "model_purpose" NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "universe" ADD CONSTRAINT "universe_base_universe_id_universe_id_fk" FOREIGN KEY ("base_universe_id") REFERENCES "public"."universe"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universe_member" ADD CONSTRAINT "universe_member_universe_id_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity" ADD CONSTRAINT "entity_universe_id_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation" ADD CONSTRAINT "relation_universe_id_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation" ADD CONSTRAINT "relation_relation_type_id_relation_type_id_fk" FOREIGN KEY ("relation_type_id") REFERENCES "public"."relation_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation" ADD CONSTRAINT "relation_from_entity_id_entity_id_fk" FOREIGN KEY ("from_entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation" ADD CONSTRAINT "relation_to_entity_id_entity_id_fk" FOREIGN KEY ("to_entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_type" ADD CONSTRAINT "relation_type_universe_id_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision" ADD CONSTRAINT "revision_universe_id_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision" ADD CONSTRAINT "revision_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision" ADD CONSTRAINT "revision_parent_revision_id_revision_id_fk" FOREIGN KEY ("parent_revision_id") REFERENCES "public"."revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact" ADD CONSTRAINT "fact_universe_id_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact" ADD CONSTRAINT "fact_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact" ADD CONSTRAINT "fact_source_revision_id_revision_id_fk" FOREIGN KEY ("source_revision_id") REFERENCES "public"."revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_call" ADD CONSTRAINT "model_call_universe_id_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universe"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "universe_owner_slug_key" ON "universe" USING btree ("owner_user_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_universe_slug_key" ON "entity" USING btree ("universe_id","slug");--> statement-breakpoint
CREATE INDEX "entity_aliases_gin_idx" ON "entity" USING gin ("aliases");--> statement-breakpoint
CREATE UNIQUE INDEX "relation_type_from_to_key" ON "relation" USING btree ("relation_type_id","from_entity_id","to_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "relation_type_universe_label_key" ON "relation_type" USING btree ("universe_id","label");--> statement-breakpoint
CREATE INDEX "model_call_universe_created_idx" ON "model_call" USING btree ("universe_id","created_at");--> statement-breakpoint
CREATE INDEX "model_call_user_created_idx" ON "model_call" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "model_config_active_purpose_key" ON "model_config" USING btree ("purpose") WHERE "model_config"."active" = true;