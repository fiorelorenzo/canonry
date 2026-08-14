-- SPEC.md §9: "the active model lives in the database and is the one always used",
-- switchable from an admin surface without a deploy. These are the two rows the spec names,
-- and the reason there are two is the reason the feature column exists: p-image returns one
-- image per request, so it is what a portrait uses, while flux-schnell is only selected
-- where a batch of up to four variants is wanted, such as choosing between portraits.
--
-- The euro rates in params are what model_call.cost_eur is computed from, and they are our
-- cost rather than the user's price: what the user spends is operation_price (image.portrait
-- and image.variants), which an admin edits separately. Keeping the two apart is what makes
-- the margin question answerable at all.
INSERT INTO "image_model_config" ("feature", "provider", "model_id", "active", "params")
VALUES
	('portrait', 'replicate', 'prunaai/p-image', true, '{"eurPerImage":0.02,"imagesPerRequest":1}'),
	(
		'variants',
		'replicate',
		'black-forest-labs/flux-schnell',
		true,
		'{"eurPerImage":0.01,"imagesPerRequest":4}'
	)
ON CONFLICT DO NOTHING;
