-- Nothing has ever seeded the text models, which means the Loremaster has never worked on a fresh
-- deployment: `resolveModel(db, 'cheap')` throws `ModelNotConfiguredError` and every propagation,
-- audit, completion and premium answer fails at the first line. Migration 0011 seeds the image
-- models and 0022 the embedding one, so this was the only purpose left living on rows somebody had
-- inserted by hand in dev. Found by deploying v0.4.0 and reading `model_config` on prod: two image
-- rows, one embedding row, no text rows at all.
--
-- Same models and prices as 0023, which fixed the stale ids on databases that already had rows.
-- That migration is an UPDATE, so it does nothing here; this one is the INSERT for a database that
-- never had them. Both are idempotent, and running them in either order lands the same two rows.
--
-- Prices are the gateway's own list on 2026-08-15 converted at the ECB reference rate for that day
-- (1 EUR = 1.1567 USD): claude-haiku-4.5 at $1.00/$5.00 per million becomes 0.86/4.32 EUR, and
-- claude-opus-4.8 at $5.00/$25.00 becomes 4.32/21.61. `model_call.cost_eur` is computed from these
-- and is the "what it cost us" half of SPEC.md §15's margin question, so the currency matters.
INSERT INTO "model_config" ("purpose", "provider", "model_id", "active", "params")
VALUES
	(
		'cheap',
		'anthropic',
		'claude-haiku-4.5',
		true,
		'{"eurPerInputMTok":0.86,"eurPerOutputMTok":4.32}'
	),
	(
		'premium',
		'anthropic',
		'claude-opus-4.8',
		true,
		'{"eurPerInputMTok":4.32,"eurPerOutputMTok":21.61}'
	)
ON CONFLICT DO NOTHING;
