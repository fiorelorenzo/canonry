-- Issue #132: `image_model_config.params.eurPerImage` held Replicate's USD list price
-- (migration 0011: prunaai/p-image at 0.02, black-forest-labs/flux-schnell at 0.01) in a
-- column named euros, so every `model_call.cost_eur` an image generated was about 15% too
-- high. Every price in `model_config` has the same shape problem even where the number
-- itself was right: 0022-0028 each converted a provider's USD list price to EUR at seed
-- time and left the rate in a migration comment, so nothing after those migrations knew
-- which rate produced a stored figure or could tell a real EUR price from a converted one
-- by looking at the row.
--
-- The fix, decided on the issue rather than picked: store the provider's own currency
-- alongside the number (`ModelParams.currency` / `ImageModelParams.currency`,
-- @canonry/ai / @canonry/media) and convert at read time, from the one dated rate
-- `@canonry/ai`'s `computeCost` reads (`toEur`, packages/ai/src/currency.ts). A provider's
-- price list is the durable fact; the exchange rate is not. This migration restates every
-- price this repo has ever seeded under that shape - the field names themselves lose their
-- "eur" prefix (`pricePerInputMTok`, `pricePerOutputMTok`, `pricePerEmbeddingMTok`,
-- `pricePerImage`), since a field called euros that holds dollars is how the image bug
-- happened, and every row here gets an explicit `"currency":"USD"` alongside its native
-- provider figure. Every number below is the same USD list price each source migration's
-- own comment already recorded; only the shape changes, not the arithmetic.
--
-- For the record, the two image rows this issue was filed over: $0.02 and $0.01 convert to
-- 0.0173 and 0.0086 EUR at 1 EUR = 1.1567 USD (2026-08-15, the rate `toEur` now carries).
-- That conversion happens at read time from here on, not in this migration.
--> statement-breakpoint

-- image_model_config: the two rows issue #132 was filed over.
UPDATE "image_model_config"
SET "params" = '{"pricePerImage":0.02,"imagesPerRequest":1,"currency":"USD"}'
WHERE "feature" = 'portrait' AND "provider" = 'replicate' AND "model_id" = 'prunaai/p-image';
--> statement-breakpoint

UPDATE "image_model_config"
SET "params" = '{"pricePerImage":0.01,"imagesPerRequest":4,"currency":"USD"}'
WHERE "feature" = 'variants' AND "provider" = 'replicate'
	AND "model_id" = 'black-forest-labs/flux-schnell';
--> statement-breakpoint

-- model_config: every text/embedding row a migration has ever priced, active or not.
-- Inactive rows are restated too - migration 0028 showed a deactivated purpose can come
-- back (its own reactivation branch), and a row a future admin edit revives should not
-- silently price at zero because it still carries the old field names.
UPDATE "model_config"
SET "params" = '{"pricePerInputMTok":1.00,"pricePerOutputMTok":5.00,"currency":"USD"}'
WHERE "purpose" = 'cheap' AND "provider" = 'anthropic' AND "model_id" = 'claude-haiku-4.5';
--> statement-breakpoint

UPDATE "model_config"
SET "params" = '{"pricePerInputMTok":5.00,"pricePerOutputMTok":25.00,"currency":"USD"}'
WHERE "purpose" = 'premium' AND "provider" = 'anthropic' AND "model_id" = 'claude-opus-4.8';
--> statement-breakpoint

UPDATE "model_config"
SET "params" = '{"pricePerInputMTok":0.25,"pricePerOutputMTok":1.50,"currency":"USD"}'
WHERE "purpose" = 'cheap' AND "provider" = 'google' AND "model_id" = 'gemini-3.1-flash-lite';
--> statement-breakpoint

UPDATE "model_config"
SET "params" = '{"pricePerInputMTok":0.25,"pricePerOutputMTok":1.50,"currency":"USD"}'
WHERE "purpose" = 'multimodal' AND "provider" = 'google' AND "model_id" = 'gemini-3.1-flash-lite';
--> statement-breakpoint

UPDATE "model_config"
SET "params" = '{"pricePerInputMTok":2.50,"pricePerOutputMTok":15.00,"currency":"USD"}'
WHERE "purpose" = 'premium' AND "provider" = 'openai' AND "model_id" = 'gpt-5.4';
--> statement-breakpoint

UPDATE "model_config"
SET "params" = '{"pricePerEmbeddingMTok":0.02,"currency":"USD"}'
WHERE "purpose" = 'embedding' AND "provider" = 'alibaba' AND "model_id" = 'qwen3-embedding-4b';
