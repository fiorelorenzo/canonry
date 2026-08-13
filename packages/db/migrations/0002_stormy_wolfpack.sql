DROP INDEX "relation_type_universe_label_key";--> statement-breakpoint
ALTER TABLE "relation_type" ADD CONSTRAINT "relation_type_universe_label_key" UNIQUE NULLS NOT DISTINCT("universe_id","label");