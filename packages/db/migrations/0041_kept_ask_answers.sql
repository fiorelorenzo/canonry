CREATE TYPE "public"."ask_detail_level" AS ENUM('1_line', 'short', 'normal', 'detailed', 'full');--> statement-breakpoint
CREATE TYPE "public"."kept_answer_source_kind" AS ENUM('own_canon', 'indexed');--> statement-breakpoint
CREATE TABLE "kept_answer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" uuid NOT NULL,
	"kept_by" text NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"detail_level" "ask_detail_level" NOT NULL,
	"locale" text NOT NULL,
	"asked_from_path" text NOT NULL,
	"provider" text,
	"model_id" text,
	"kept_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kept_answer_question_present" CHECK (length(btrim("kept_answer"."question")) > 0),
	CONSTRAINT "kept_answer_answer_present" CHECK (length(btrim("kept_answer"."answer")) > 0),
	CONSTRAINT "kept_answer_asked_from_path_relative" CHECK ("kept_answer"."asked_from_path" like '/%' and "kept_answer"."asked_from_path" not like '//%')
);
--> statement-breakpoint
CREATE TABLE "kept_answer_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kept_answer_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"kind" "kept_answer_source_kind" NOT NULL,
	"entity_id" uuid,
	"data_source_id" uuid,
	"page_title" text,
	"url" text,
	"statement" text NOT NULL,
	CONSTRAINT "kept_answer_source_own_canon_shape" CHECK ("kept_answer_source"."kind" <> 'own_canon' or ("kept_answer_source"."data_source_id" is null and "kept_answer_source"."page_title" is null and "kept_answer_source"."url" is null)),
	CONSTRAINT "kept_answer_source_indexed_shape" CHECK ("kept_answer_source"."kind" <> 'indexed' or ("kept_answer_source"."entity_id" is null and "kept_answer_source"."page_title" is not null and "kept_answer_source"."url" is not null))
);
--> statement-breakpoint
ALTER TABLE "kept_answer" ADD CONSTRAINT "kept_answer_universe_id_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kept_answer" ADD CONSTRAINT "kept_answer_kept_by_user_id_fk" FOREIGN KEY ("kept_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kept_answer_source" ADD CONSTRAINT "kept_answer_source_kept_answer_id_kept_answer_id_fk" FOREIGN KEY ("kept_answer_id") REFERENCES "public"."kept_answer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kept_answer_source" ADD CONSTRAINT "kept_answer_source_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kept_answer_source" ADD CONSTRAINT "kept_answer_source_data_source_id_data_source_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kept_answer_universe_kept_by_idx" ON "kept_answer" USING btree ("universe_id","kept_by","kept_at");--> statement-breakpoint
CREATE UNIQUE INDEX "kept_answer_source_rank_key" ON "kept_answer_source" USING btree ("kept_answer_id","rank");--> statement-breakpoint
CREATE INDEX "kept_answer_source_entity_idx" ON "kept_answer_source" USING btree ("entity_id");