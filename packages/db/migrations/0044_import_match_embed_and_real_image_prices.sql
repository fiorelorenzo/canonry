-- Two corrections to seeded pricing rows, in one migration because this repo allows one
-- migration per wave (AGENTS.md: sequential numbering plus migrations/meta/_journal.json
-- makes two of them a conflict no rebase resolves). Issue #309 is a label, issue #333 is a
-- pair of numbers, and both are restatements of rows an earlier migration seeded.

-- Issue #309. `resolveImportSimilarity` (apps/web/src/lib/server/onboarding.ts) built its
-- embedder with `operation: 'index.embed'`, which is migration 0004's "Embedding a saved
-- entry": a universe's own canon being indexed on save. What those calls actually are is the
-- semantic step of SPEC.md §6.4's matching order, embedding an entity name with the type,
-- summary and source sentence issue #310 added to it, so a re-import can tell an update from
-- a duplicate.
--
-- Nothing was mis-billed. `index.embed` is zero as a reading operation and so is a matching
-- embed (SPEC.md §15: reading is free), so the credits were right and only the attribution
-- was wrong: import matching's gateway spend was folded into canon-save's in `model_call`,
-- which is the table the margin question of SPEC.md §11.5 is answered from. A distinct row
-- is what makes the two separable, exactly as migration 0008 gave the wiki crawl's own
-- embedding a row rather than reusing this one.
--
-- The note stays free of repo citations (issue #209, migration 0035): /admin/pricing renders
-- it verbatim to a staff admin, so the claim stays in the row and the provenance stays here.
INSERT INTO "operation_price" ("operation", "label", "credits", "kind", "notes")
VALUES
	(
		'import.match.embed',
		'Import matching embedding',
		0,
		'reading',
		'Reading is free. A re-import has to tell an update from a duplicate before it writes anything, and the semantic half of that decision embeds an entity''s name and context to compare it against what the world already has. It reads canon rather than drafting any.'
	)
ON CONFLICT ("operation") DO NOTHING;
--> statement-breakpoint

-- Issue #333. Migration 0011 seeded `params.pricePerImage` for `portrait` and `variants`
-- from the two model names SPEC.md §9 mentions, and migration 0034 restated both in
-- Replicate's own currency without revisiting the numbers, so both have been three to four
-- times Replicate's list price the whole time and every `model_call.cost_eur` an image wrote
-- overstates what we actually pay for it.
--
-- Read off each model page's own pricing block on 2026-08-19, where both are billed per
-- output image rather than per second: `prunaai/p-image` is "$5 per thousand output images",
-- so USD 0.005 against the 0.020 seeded, and `black-forest-labs/flux-schnell` is "$3 per
-- thousand output images", so USD 0.003 against the 0.010 seeded. docs/models.md's `scene`
-- table already carries both of those figures, measured on the same day by issue #258's
-- sweep, so this is a row catching up with a measurement that is already in the repo rather
-- than a new claim.
--
-- `bytedance/seedream-4`, the `scene` row migration 0042 seeded, reads back "$0.03 per
-- output image" from the same source today and is left exactly as it is. It was measured
-- rather than cited, and re-reading it is what says so.
--
-- Each statement matches the row on the exact params migration 0034 wrote, the discipline
-- migration 0035 used for the same reason: `params` is editable from /admin/models (issue
-- #221), so an admin who has already corrected a price by hand keeps their number instead of
-- having this migration overwrite it with a figure they did not choose. `imagesPerRequest`
-- and `currency` are carried through unchanged; only the price moves.
UPDATE "image_model_config"
SET "params" = '{"pricePerImage":0.005,"imagesPerRequest":1,"currency":"USD"}'
WHERE "feature" = 'portrait' AND "provider" = 'replicate' AND "model_id" = 'prunaai/p-image'
	AND "params" = '{"pricePerImage":0.02,"imagesPerRequest":1,"currency":"USD"}'::jsonb;
--> statement-breakpoint

UPDATE "image_model_config"
SET "params" = '{"pricePerImage":0.003,"imagesPerRequest":4,"currency":"USD"}'
WHERE "feature" = 'variants' AND "provider" = 'replicate'
	AND "model_id" = 'black-forest-labs/flux-schnell'
	AND "params" = '{"pricePerImage":0.01,"imagesPerRequest":4,"currency":"USD"}'::jsonb;
