-- Issue #332. `prunaai/p-image` defaults to `aspect_ratio: "16:9"` and `ReplicateImageProvider`
-- sent only `prompt` and `num_outputs`, so every portrait this product has generated came back
-- a landscape. The fix is not a constant in the provider: the shape belongs next to the model
-- that has to honour it, because an admin swapping the model from /admin/models is exactly the
-- moment a hardcoded shape would go missing. So `params.aspectRatio` joins `pricePerImage` and
-- `imagesPerRequest` as a per-feature parameter of the row, `@canonry/media` reads it
-- (models.ts) and refuses to send a value the configured model's own schema does not list
-- (aspect-ratio.ts).
--
-- **This composes with migration 0044 and the order is load-bearing.** #333 corrected these
-- same two rows' `pricePerImage` by restating the whole `params` object behind a WHERE that
-- matches the exact object migration 0034 wrote, so that an admin who had already fixed the
-- price by hand keeps their number. Two consequences. This migration adds its key with a jsonb
-- merge (`||`) rather than a restatement, so it carries 0044's corrected price, `currency` and
-- `imagesPerRequest` through untouched whatever they are. And it has to run after 0044, which
-- sequential numbering gives it: reversed, `aspectRatio` would already be on the row, 0044's
-- exact-match WHERE would match nothing and the price correction would silently no-op. The
-- same argument says nothing here may ever restate `params` either, or it would undo #333 the
-- same way.
--
-- `portrait` gets 3:2 because that is the shape the picture is already displayed at: #284
-- decided the cover band's crop per entity type and `COVER_RATIO` puts a character and an
-- item, the two types whose portrait is a subject rather than a place, at exactly 3/2. Every
-- wider band (16/9 for a faction, 21/9 for a place, an event and a session) is then a
-- top-and-bottom crop of a 3:2 source, which is what `COVER_POSITION` was written for, and
-- nothing is ever cropped at the sides where a face is. 16:9 was the opposite: wider than
-- every band except a place's, so a character's cover was cropped at the sides and
-- `COVER_POSITION`'s `center top` for a character could not do anything at all.
--
-- `variants` gets the same 3:2, since its whole job is four alternates of the picture
-- `portrait` produces and a chooser that offers a different shape from the one that will be
-- used is lying. 3:2 is in both models' enums, which is why it is available to both.
--
-- `scene` gets the 16:9 it already had: #258 measured every candidate at 16:9 and
-- `ASPECT_RATIO_BY_FEATURE` in packages/media/src/generate.ts was where it lived until now.
-- This migration moves that constant into the row and deletes the table; the behaviour of a
-- scene does not change, and its price, which 0044 re-read and deliberately left alone, is
-- not touched here either.
--
-- Scoped to the model each row was seeded with (migration 0011 for the first two, 0042 for
-- the third) rather than to the feature alone, the same discipline 0044 and 0035 use. A
-- deployment that has already pointed one of these features at some other model gets nothing
-- here and keeps whatever that model defaults to: writing a ratio a migration cannot check
-- would turn a silently wrong shape into a refused generation, which is worse than the status
-- quo for a row nobody asked me about. Setting one there is an /admin/models save, which does
-- check.
UPDATE "image_model_config"
SET "params" = "params" || '{"aspectRatio":"3:2"}'::jsonb, "updated_at" = now()
WHERE "feature" = 'portrait' AND "provider" = 'replicate' AND "model_id" = 'prunaai/p-image';
--> statement-breakpoint

UPDATE "image_model_config"
SET "params" = "params" || '{"aspectRatio":"3:2"}'::jsonb, "updated_at" = now()
WHERE "feature" = 'variants' AND "provider" = 'replicate'
	AND "model_id" = 'black-forest-labs/flux-schnell';
--> statement-breakpoint

UPDATE "image_model_config"
SET "params" = "params" || '{"aspectRatio":"16:9"}'::jsonb, "updated_at" = now()
WHERE "feature" = 'scene' AND "provider" = 'replicate'
	AND "model_id" = 'bytedance/seedream-4';
