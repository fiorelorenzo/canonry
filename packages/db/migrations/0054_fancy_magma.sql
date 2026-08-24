ALTER TABLE "kept_answer" ADD COLUMN "truncated" boolean;--> statement-breakpoint
ALTER TABLE "kept_answer" ADD COLUMN "lost_proposals" integer;--> statement-breakpoint
ALTER TABLE "kept_answer" ADD CONSTRAINT "kept_answer_loss_shape" CHECK (("kept_answer"."truncated" is null) = ("kept_answer"."lost_proposals" is null));--> statement-breakpoint
ALTER TABLE "kept_answer" ADD CONSTRAINT "kept_answer_lost_proposals_non_negative" CHECK ("kept_answer"."lost_proposals" is null or "kept_answer"."lost_proposals" >= 0);