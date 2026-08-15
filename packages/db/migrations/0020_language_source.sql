CREATE TYPE "public"."language_source" AS ENUM('detected', 'human');--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "language_source" "language_source" DEFAULT 'detected' NOT NULL;