CREATE TYPE "public"."operation_price_kind" AS ENUM('generation', 'reading', 'import');--> statement-breakpoint
CREATE TABLE "operation_price" (
	"operation" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"credits" numeric(12, 4) DEFAULT 0 NOT NULL,
	"kind" "operation_price_kind" NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "operation_price_credits_non_negative" CHECK ("operation_price"."credits" >= 0)
);
--> statement-breakpoint
CREATE TABLE "operation_price_change" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation" text NOT NULL,
	"old_credits" numeric(12, 4) NOT NULL,
	"new_credits" numeric(12, 4) NOT NULL,
	"changed_by" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operation_price_change" ADD CONSTRAINT "operation_price_change_operation_operation_price_operation_fk" FOREIGN KEY ("operation") REFERENCES "public"."operation_price"("operation") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operation_price_change_operation_changed_idx" ON "operation_price_change" USING btree ("operation","changed_at");