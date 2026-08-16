-- Decision K1, issue #190: the three non-'existing' outcomes of
-- @canonry/copilot's resolveRelationType (issue #189) each get their own
-- proposal_kind, mirroring 'flag' (migration 0016) rather than overloading
-- 'relation' with a shape it was never meant to carry.
ALTER TYPE "public"."proposal_kind" ADD VALUE 'relation_type_reuse';--> statement-breakpoint
ALTER TYPE "public"."proposal_kind" ADD VALUE 'relation_type_widen';--> statement-breakpoint
ALTER TYPE "public"."proposal_kind" ADD VALUE 'relation_type_new';
