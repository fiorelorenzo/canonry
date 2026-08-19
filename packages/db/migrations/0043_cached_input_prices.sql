-- Issue #313: what a provider charges for an input token it served from its own prompt
-- cache, which every one of these rows was being billed at the full input rate.
--
-- #271 measured the reason this matters: the import loop resends its whole prefix on every
-- step, and 730,321 of one sweep's 1,363,296 input tokens came back flagged as served from
-- Gemini's implicit cache. `ModelParams` had no cached rate, so `computeCost` priced all of
-- them as fresh, which overstated credits, made `wouldExceedCeiling` refuse steps a job
-- could afford, and left `estimate.ts`'s per-document figures calibrated against the
-- overstatement (#330 re-derives those separately).
--
-- Every rate below is the gateway's own price list on 2026-08-19, read from the
-- `input_cache_read` and `input_cache_write` fields of `GET /v1/models`, in the provider's
-- own currency exactly as #132 requires and as the `"currency":"USD"` these rows already
-- carry declares. Not a ratio: the read rate is 12 per cent of input on
-- `gemini-3.1-flash-lite` and 10 per cent on `gpt-5.4`, so a single assumed multiplier
-- would have been wrong on one of the two, which is why the #271 spike deliberately
-- refused to guess one.
--
--   google/gemini-3.1-flash-lite   input 0.25   cache read 0.03   no write rate quoted
--   openai/gpt-5.4                 input 2.50   cache read 0.25   no write rate quoted
--   anthropic/claude-haiku-4.5     input 1.00   cache read 0.10   cache write 1.25
--   anthropic/claude-opus-4.8      input 5.00   cache read 0.50   cache write 6.25
--
-- The two Anthropic rows are inactive (migration 0028 deactivated rather than deleted them)
-- and are restated anyway, the same choice and for the same reason 0034 made it: a row a
-- future admin edit revives should not silently price cache reads at the fresh rate. They
-- are also the rows that need the write rate at all. Google and OpenAI cache implicitly and
-- are quoted no write price, so `pricePerCacheWriteMTok` is genuinely absent for them rather
-- than unknown, and `computeCost` falls back to the plain input rate for an absent write
-- rate, which is both the safe direction and the right number for a bucket that is always
-- zero on an implicit cache.
--
-- Two rows deliberately get nothing. `embedding` (`alibaba/qwen3-embedding-4b`) is quoted no
-- cached rate because an embedding call has no prompt to cache, and its tokens are priced
-- through `pricePerEmbeddingMTok` on a separate term anyway. And nothing in
-- `image_model_config`, including the `scene` row migration 0042 has just seeded:
-- `ImageModelParams` carries no token rate of any kind, an image generation reports no input
-- tokens, so a cached-input rate there would be a price for a dimension the row cannot have.
--
-- `params || '{...}'` rather than a whole-object replacement, unlike 0034: this adds one key
-- rather than renaming every key, so merging leaves any admin edit at `/admin/models`
-- untouched and makes the statement idempotent.

UPDATE "model_config"
SET "params" = "params" || '{"pricePerCachedInputMTok":0.03}'::jsonb, "updated_at" = now()
WHERE "provider" = 'google' AND "model_id" = 'gemini-3.1-flash-lite';
--> statement-breakpoint

UPDATE "model_config"
SET "params" = "params" || '{"pricePerCachedInputMTok":0.25}'::jsonb, "updated_at" = now()
WHERE "provider" = 'openai' AND "model_id" = 'gpt-5.4';
--> statement-breakpoint

UPDATE "model_config"
SET "params" = "params" || '{"pricePerCachedInputMTok":0.10,"pricePerCacheWriteMTok":1.25}'::jsonb,
	"updated_at" = now()
WHERE "provider" = 'anthropic' AND "model_id" = 'claude-haiku-4.5';
--> statement-breakpoint

UPDATE "model_config"
SET "params" = "params" || '{"pricePerCachedInputMTok":0.50,"pricePerCacheWriteMTok":6.25}'::jsonb,
	"updated_at" = now()
WHERE "provider" = 'anthropic' AND "model_id" = 'claude-opus-4.8';
