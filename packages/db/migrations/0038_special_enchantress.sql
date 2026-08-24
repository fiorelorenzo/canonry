-- Decision C3 amendment (docs/design/DECISIONS.md "Round nine", SPEC.md §5.1): the
-- propagation plan cap moves from a hardcoded ~10 to a per-universe setting, in the
-- same shape decision C10's `ai_enabled` already uses. `propagation_cap` null means
-- the GM turned the limit off - a real value, not a sentinel like 0 or 9999, because
-- "no limit" and "the default applies" have to stay two states a query can tell
-- apart. Default 25 (see packages/db/src/schema/universe.ts's column comment for the
-- arithmetic: a plan costs 1 credit to write plus 1 credit per diffed candidate, so
-- 25 bounds one save at 26 credits, 0.52% of the included tier's 5,000 credits per
-- period). Existing universes backfill to 25 rather than to null, so this migration
-- makes every universe more generous than the old constant, not unbounded, until a
-- GM explicitly asks for no limit.
--
-- `proposal_plan.candidate_cap` drops its NOT NULL for the same reason: it records
-- the cap that was actually in effect when a given plan was written, and a plan
-- written with no limit has to be able to say so rather than lying with a number.
ALTER TABLE "proposal_plan" ALTER COLUMN "candidate_cap" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "universe" ADD COLUMN "propagation_cap" integer DEFAULT 25;--> statement-breakpoint
ALTER TABLE "universe" ADD CONSTRAINT "universe_propagation_cap_positive" CHECK ("universe"."propagation_cap" is null or "universe"."propagation_cap" > 0);