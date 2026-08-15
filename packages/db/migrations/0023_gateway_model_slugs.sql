-- Issue #97's gateway switch left `model_config` naming models that no longer exist. The rows
-- said `anthropic/claude-3-5-haiku-20241022` and `anthropic/claude-opus-4-1-20250805`, which were
-- Cloudflare's pass-through ids; Vercel AI Gateway routes neither, so every Loremaster text call
-- in this deployment failed with "No output generated" while the build, the typecheck and all 823
-- tests stayed green. Nothing exercised a real language-model call with the *configured* ids,
-- which is the gap `packages/ai/src/gateway.test.ts` now covers.
--
-- Successors, chosen like-for-like rather than as a fresh model decision, with prices read from
-- the gateway's own /v1/models list on 2026-08-15 and converted at the ECB reference rate for
-- that day (1 EUR = 1.1567 USD, so USD * 0.8645):
--
--   cheap:   claude-haiku-4.5  $1.00/$5.00 per 1M in/out  ->  0.86 / 4.32 EUR
--   premium: claude-opus-4.8   $5.00/$25.00               ->  4.32 / 21.61 EUR
--
-- Worth noting for the margin question (SPEC.md §15): the premium model is now cheaper than what
-- it replaces, since the old opus-4-1 listed at $15/$75. Every other opus on the gateway (4.5,
-- 4.6, 4.7) is priced identically to 4.8, so there is no cost argument for staying behind. Both
-- rows are an admin edit at /admin/models, not a deploy, which is the whole point of the table.
UPDATE "model_config"
SET "model_id" = 'claude-haiku-4.5',
	"params" = '{"eurPerInputMTok":0.86,"eurPerOutputMTok":4.32}'
WHERE "purpose" = 'cheap' AND "provider" = 'anthropic' AND "active" = true;

UPDATE "model_config"
SET "model_id" = 'claude-opus-4.8',
	"params" = '{"eurPerInputMTok":4.32,"eurPerOutputMTok":21.61}'
WHERE "purpose" = 'premium' AND "provider" = 'anthropic' AND "active" = true;
