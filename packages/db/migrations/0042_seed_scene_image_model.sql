-- Issue #258. `image_feature` has had three values since migration 0011 and
-- `image_model_config` has had two rows, so `scene` was reachable from the type system and
-- dead in the database. Nothing silently substituted a model for it: `operationForFeature`
-- (packages/media/src/generate.ts) threw `UnsupportedImageFeatureError` before touching the
-- database, and the two surfaces that could have asked narrowed it out first. What happened
-- instead is that the one place that wants a scene, an image inserted into an entry's body,
-- asked for `portrait`, and got a model chosen for a face at whatever aspect ratio that
-- model defaults to.
--
-- Unlike 0011, this row is a measurement rather than a citation. `bytedance/seedream-4` won
-- a five-arm sweep over six Valdoria Reach entries scored on shape, subject and how much of
-- the entry the picture shows, against the model `portrait` already runs (with and without
-- the scene framing clause, as a control), `black-forest-labs/flux-schnell` and
-- `black-forest-labs/flux-1.1-pro`. The table, the rejected alternatives and what each would
-- have cost are in docs/models.md's `scene` section; the harness is
-- `packages/bench/src/media/scene.ts` and re-running it is one command.
--
-- `pricePerImage` is Replicate's own list price on 2026-08-19 in its own currency (issue
-- #132: never pre-converted, `computeCost` converts at read time). `imagesPerRequest` is 1,
-- the same as `portrait`: a scene is one picture, and `variants` remains the only batch.
INSERT INTO "image_model_config" ("feature", "provider", "model_id", "active", "params")
VALUES
	(
		'scene',
		'replicate',
		'bytedance/seedream-4',
		true,
		'{"pricePerImage":0.03,"imagesPerRequest":1,"currency":"USD"}'
	)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- What the GM spends, which is a different number from what we spend (issue #113): 4 credits,
-- not the 3 that `image.portrait` charges. A credit is EUR 0.01, so 3 credits would sell an
-- EUR 0.0259 seedream-4 image at a 14 per cent margin where a portrait sells at 86 per cent.
-- 4 credits is the figure `image.variants` already uses and gives 35 per cent, which is
-- honest about the model being expensive rather than pretending a scene costs what a portrait
-- costs. docs/models.md states the arithmetic and says plainly that if this margin has to
-- match `image.portrait`'s, the model to pick is `flux-schnell` and the decision is a pricing
-- one rather than a measurement.
INSERT INTO "operation_price" ("operation", "label", "credits", "kind", "notes")
VALUES
	('image.scene', 'Scene image', 4.0000, 'generation',
		'Issue #258: one wide (16:9) image for an entry body. 4 credits rather than image.portrait''s 3 because the measured model costs EUR 0.0259 an image against a portrait''s EUR 0.0043; same figure image.variants uses. See docs/models.md.')
ON CONFLICT DO NOTHING;
