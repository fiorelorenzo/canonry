-- Issue #209, filed out of #202: fifteen of the sixty string literals seeded by
-- migration 0004 (packages/db/migrations/0004_seed_operation_price_catalogue.sql)
-- cite SPEC.md §15, SPEC.md §8.1, SPEC.md §9, docs/ux/h1-what-off-is-called.html,
-- docs/ux/f2-quota-and-cost.html, docs/ux/SAMPLE-WORLD.md, docs/ux/d2-estimate-and-progress.html
-- and docs/ux/DECISIONS.md inside operation_price.notes. Four later migrations -
-- 0008_seed_indexing_prices.sql, 0013_seed_media_similarity_price.sql and
-- 0017_seed_audio_layers_parse_price.sql - seeded four more rows the same way,
-- citing SPEC.md and decision H1. apps/web/src/routes/admin/pricing/+page.svelte
-- renders every row's notes verbatim, so a staff admin reads a repo citation on
-- /admin/pricing. Same rule as #202: a note keeps its claim and loses the
-- citation, and the provenance moves here, to a SQL comment nobody renders.
--
-- notes is editable from the admin panel (#113), so this cannot be a blind
-- UPDATE by operation: each statement matches a row on operation *and* the
-- exact text its seed migration wrote, and only rewrites where that text is
-- still in place. A row an admin has since edited by hand no longer matches
-- the old text and is left alone, on either side of this migration.

UPDATE "operation_price" SET "notes" =
	'Reading is free: indexing a save is what makes search possible at all, charging for it would tax the act of saving.'
	WHERE "operation" = 'index.embed' AND "notes" =
	'Reading is free (SPEC.md §15): indexing a save is what makes search possible at all, charging for it would tax the act of saving.';

UPDATE "operation_price" SET "notes" =
	'Reading is free, and charging for search would make searching your own canon feel expensive.'
	WHERE "operation" = 'search.semantic' AND "notes" =
	'Reading is free (SPEC.md §15): charging for search would make the honest thing - searching your own canon - feel expensive.';

UPDATE "operation_price" SET "notes" =
	'Reading is free: a mention suggestion only reads the existing graph, it drafts nothing.'
	WHERE "operation" = 'mention.suggest' AND "notes" =
	'Reading is free (SPEC.md §15): a mention suggestion only reads the existing graph, it drafts nothing.';

UPDATE "operation_price" SET "notes" =
	'Reading is free: the retrieval half of an Ask answer is search, not generation; only the model call that writes the answer is priced.'
	WHERE "operation" = 'ask.retrieval' AND "notes" =
	'Reading is free (SPEC.md §15): the retrieval half of Ask is search, not generation; only ask.answer, the model call that writes the reply, is priced.';

UPDATE "operation_price" SET "notes" =
	'2 credits, on par with a drafted entry since both are one generated passage of prose.'
	WHERE "operation" = 'ask.answer' AND "notes" =
	'docs/ux/h1-what-off-is-called.html pricing mockup: 2 credits, on par with a drafted entry since both are one generated passage of prose.';

UPDATE "operation_price" SET "notes" =
	'1 credit for the candidate-identification pass. Combined with the per-entry diff price below, a ten-entry propagation plan totals 1 + 10x1 = 11 credits, matching the agreed fixture.'
	WHERE "operation" = 'propagate.plan' AND "notes" =
	'docs/ux/h1-what-off-is-called.html pricing mockup: 1 credit for the candidate-identification pass. Combined with propagate.diff below, a ten-entry plan totals 1 + 10x1 = 11 credits, matching the fixture in docs/ux/f2-quota-and-cost.html and docs/ux/DECISIONS.md.';

UPDATE "operation_price" SET "notes" =
	'1 credit per drafted diff. See the propagation plan price above for the ten-entry fixture total this reproduces.'
	WHERE "operation" = 'propagate.diff' AND "notes" =
	'docs/ux/h1-what-off-is-called.html pricing mockup: 1 credit per drafted diff. See propagate.plan above for the fixture total this reproduces.';

UPDATE "operation_price" SET "notes" =
	'2 credits, same as a generated Ask answer - both are one full generated passage.'
	WHERE "operation" = 'entry.complete' AND "notes" =
	'docs/ux/h1-what-off-is-called.html pricing mockup: 2 credits, same as ask.answer - both are one full generated passage.';

UPDATE "operation_price" SET "notes" =
	'1 credit, a short flag-and-reason rather than a full drafted passage.'
	WHERE "operation" = 'audit.flag' AND "notes" =
	'docs/ux/h1-what-off-is-called.html pricing mockup: 1 credit, a short flag-and-reason rather than a full drafted passage.';

UPDATE "operation_price" SET "notes" =
	'A portrait costs 3 credits.'
	WHERE "operation" = 'image.portrait' AND "notes" =
	'Fixture number from docs/ux/SAMPLE-WORLD.md and docs/ux/f2-quota-and-cost.html: a portrait costs 3 credits.';

UPDATE "operation_price" SET "notes" =
	'4 credits for a batch of up to 4 alternates, priced above a single portrait because it renders more images per call.'
	WHERE "operation" = 'image.variants' AND "notes" =
	'docs/ux/h1-what-off-is-called.html pricing mockup: 4 credits for a batch of up to 4 alternates (SPEC.md §9''s flux-schnell variant picker), priced above a single portrait because it renders more images per call.';

UPDATE "operation_price" SET "notes" =
	'An ambient pack costs 3 credits per generated layer.'
	WHERE "operation" = 'audio.layer' AND "notes" =
	'Fixture number from SPEC.md §8.1 and docs/ux/SAMPLE-WORLD.md: an ambient pack costs 3 credits per generated layer.';

UPDATE "operation_price" SET "notes" =
	'1 credit, a short pre-computed brief.'
	WHERE "operation" = 'warm.brief' AND "notes" =
	'docs/ux/h1-what-off-is-called.html pricing mockup: 1 credit, a short pre-computed brief (SPEC.md §8.1 warm_artifact).';

UPDATE "operation_price" SET "notes" =
	'1 credit, priced with the warm scene brief since both are pre-computed material rather than an on-demand answer.'
	WHERE "operation" = 'warm.npc_draft' AND "notes" =
	'docs/ux/h1-what-off-is-called.html pricing mockup: 1 credit, priced with warm.brief since both are pre-computed warm_artifact material rather than an on-demand answer.';

UPDATE "operation_price" SET "notes" =
	'Importing 214 documents cost 41 credits, i.e. 41 / 214 = 0.1916 credits per document - only representable because credits is numeric, not an integer column.'
	WHERE "operation" = 'import.document' AND "notes" =
	'Fixture number from docs/ux/SAMPLE-WORLD.md and docs/ux/d2-estimate-and-progress.html: importing 214 documents cost 41 credits, i.e. 41 / 214 = 0.1916 credits per document - only representable because credits is numeric, not an integer column.';

UPDATE "operation_price" SET "notes" =
	'Reading is free: one cheap LLM call per chunk to extract a summary, the questions it can answer and its keywords, recorded at its real cost.'
	WHERE "operation" = 'index.wiki.extract' AND "notes" =
	'Reading is free (SPEC.md §15). One cheap LLM call per chunk to extract summary, answerable questions and keywords (§7). Recorded in model_call with its real cost.';

UPDATE "operation_price" SET "notes" =
	'Reading is free: batch embedding of the chunks produced while indexing, the same rationale as embedding a single saved entry.'
	WHERE "operation" = 'index.wiki.embed' AND "notes" =
	'Reading is free (SPEC.md §15). Batch embedding of indexed chunks (§7, §11.3), the same rationale as index.embed.';

UPDATE "operation_price" SET "notes" =
	'Reading is free: checking for a cached duplicate before generating is what makes avoiding a double charge possible, and is not itself a generation.'
	WHERE "operation" = 'media.similarity_check' AND "notes" =
	'Reading is free (SPEC.md §15, decision H1). Checking for a cached duplicate before generating is what makes avoiding a double charge possible, and is not itself a generation.';

UPDATE "operation_price" SET "notes" =
	'Free to the user: only the generation of each resulting layer is priced, at 3 credits per layer. Kind is generation rather than reading because a model does write something here, it just is not what gets billed.'
	WHERE "operation" = 'audio.layers_parse' AND "notes" =
	'Free to the user: only the generation of each resulting layer is priced (audio.layer, 3 credits per layer, SPEC.md §8.1). Kind is generation rather than reading because a model does write something here, it just is not what gets billed.';
