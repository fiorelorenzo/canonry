CREATE TABLE "image_style_label" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_style_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "image_style_label_style_locale_key" UNIQUE("image_style_id","locale")
);
--> statement-breakpoint
DROP INDEX "image_style_universe_idx";--> statement-breakpoint
ALTER TABLE "image_style" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "image_style" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "image_style" ADD COLUMN "example_path" text;--> statement-breakpoint
ALTER TABLE "image_style" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "image_style_label" ADD CONSTRAINT "image_style_label_image_style_id_image_style_id_fk" FOREIGN KEY ("image_style_id") REFERENCES "public"."image_style"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "image_style_universe_idx" ON "image_style" USING btree ("universe_id");--> statement-breakpoint
ALTER TABLE "image_style" ADD CONSTRAINT "image_style_slug_unique" UNIQUE("slug");