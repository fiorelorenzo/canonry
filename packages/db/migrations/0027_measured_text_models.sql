-- The text and vision models, chosen by measurement instead of by guess (docs/models.md).
--
-- Migration 0024 seeded `anthropic/claude-haiku-4.5` for `cheap` and `anthropic/claude-opus-4.8`
-- for `premium` because those were plausible, and said so. `packages/bench` then ran every
-- candidate the gateway routes through the product's own functions - `writePlanRationale`,
-- `judgeStatementPair`, the `GatewayDriver` loop, `writeEntityDiff`, `completeEntry`, `runAsk` -
-- against a gold corpus, and the plausible answers came third and sixth.
--
-- Weighted by the call volume each purpose actually carries in a month (docs/models.md states
-- the volumes):
--
--   cheap     google/gemini-3.1-flash-lite  0.917   claude-haiku-4.5  0.862
--   premium   openai/gpt-5.4                0.916   claude-opus-4.8   0.752
--
-- and the cheap row is four and a half times cheaper than what it replaces, the premium row
-- three times. The audit is the reason the cheap row is not the cheapest thing that scored well:
-- `gemini-3.1-flash-lite` got all twenty labelled statement pairs right, where the next cheapest
-- candidate false-flags two of every five pairs that do not actually disagree, which is
-- SPEC.md §5.1's "the copilot becomes noise" arriving through the audit door.
--
-- `multimodal` has never had a row at all, so SPEC.md §6.3's `page_image` path has always failed
-- with ModelNotConfiguredError the moment a scanned page reached it. Every current vision model
-- reads a scanned page at essentially the same accuracy, so that row is decided on cost and
-- latency and lands on the same model as `cheap`.
--
-- Prices are the gateway's own list on 2026-08-15 at that day's ECB rate (1 EUR = 1.1567 USD),
-- the same conversion 0024 used:
--   gemini-3.1-flash-lite  $0.25 / $1.50 per Mtok -> 0.2161 / 1.2968 EUR
--   gpt-5.4                $2.50 / $15.00        -> 2.1613 / 12.9679 EUR
--
-- Idempotent, and safe on a database that already carries the 0024 rows: the old rows are
-- deactivated rather than deleted, so the history of what was active stays readable and a
-- rollback is one UPDATE.

UPDATE "model_config" SET "active" = false, "updated_at" = now()
WHERE "purpose" IN ('cheap', 'premium', 'multimodal') AND "active" = true;
--> statement-breakpoint

-- Guarded rather than ON CONFLICT: the only unique constraint on this table is one active row
-- per purpose, so a plain INSERT would happily add a second, inactive-then-activated copy of a
-- row that already exists, and the activation below would then match two rows and fail. This is
-- not hypothetical, it is what happened the first time I ran this against a database where the
-- benchmark had already written a gpt-5.4 row.
INSERT INTO "model_config" ("purpose", "provider", "model_id", "active", "params")
SELECT
	wanted.purpose::model_purpose,
	wanted.provider,
	wanted.model_id,
	true,
	wanted.params::jsonb
FROM (
	VALUES
		('cheap', 'google', 'gemini-3.1-flash-lite', '{"eurPerInputMTok":0.2161,"eurPerOutputMTok":1.2968}'),
		('premium', 'openai', 'gpt-5.4', '{"eurPerInputMTok":2.1613,"eurPerOutputMTok":12.9679}'),
		('multimodal', 'google', 'gemini-3.1-flash-lite', '{"eurPerInputMTok":0.2161,"eurPerOutputMTok":1.2968}')
) AS wanted(purpose, provider, model_id, params)
WHERE NOT EXISTS (
	SELECT 1 FROM "model_config" existing
	WHERE existing."purpose" = wanted.purpose::model_purpose
		AND existing."provider" = wanted.provider
		AND existing."model_id" = wanted.model_id
);
--> statement-breakpoint

-- Covers the database where the row already existed and was switched off, and re-prices it, so
-- the migration lands the same state whatever it started from.
UPDATE "model_config" SET "active" = true, "updated_at" = now(),
	"params" = CASE "purpose"
		WHEN 'premium' THEN '{"eurPerInputMTok":2.1613,"eurPerOutputMTok":12.9679}'::jsonb
		ELSE '{"eurPerInputMTok":0.2161,"eurPerOutputMTok":1.2968}'::jsonb
	END
WHERE ("purpose", "provider", "model_id") IN (
	('cheap', 'google', 'gemini-3.1-flash-lite'),
	('premium', 'openai', 'gpt-5.4'),
	('multimodal', 'google', 'gemini-3.1-flash-lite')
);
