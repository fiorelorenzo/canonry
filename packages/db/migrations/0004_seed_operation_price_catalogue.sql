-- The shipped operation_price catalogue (SPEC.md §15, issue #113, docs/ux/h1-what-off-is-called.html
-- "Decided"). Reading is priced at zero because that is the whole mechanism behind "reading is
-- free" - a row saying 0, not a special case bolted onto the meter. Every other row is generation
-- or import, priced per the admin panel mockup already agreed in docs/ux/h1-what-off-is-called.html,
-- with fixture numbers reproduced exactly where the design doc gives one to check against.
INSERT INTO "operation_price"
	("operation", "label", "credits", "kind", "notes")
VALUES
	-- Reading: never draws on the user's quota (SPEC.md §15). Priced at zero through the same
	-- table as everything else, not an exception the meter special-cases.
	('index.embed', 'Embedding a saved entry', 0, 'reading',
		'Reading is free (SPEC.md §15): indexing a save is what makes search possible at all, charging for it would tax the act of saving.'),
	('search.semantic', 'Semantic search query', 0, 'reading',
		'Reading is free (SPEC.md §15): charging for search would make the honest thing - searching your own canon - feel expensive.'),
	('mention.suggest', 'Mention / relation-type suggestion', 0, 'reading',
		'Reading is free (SPEC.md §15): a mention suggestion only reads the existing graph, it drafts nothing.'),
	('ask.retrieval', 'Retrieval behind an Ask answer', 0, 'reading',
		'Reading is free (SPEC.md §15): the retrieval half of Ask is search, not generation; only ask.answer, the model call that writes the reply, is priced.'),

	-- Generation: writes or calls a model to produce something new (SPEC.md §15).
	('ask.answer', 'Ask''s generated answer', 2.0000, 'generation',
		'docs/ux/h1-what-off-is-called.html pricing mockup: 2 credits, on par with a drafted entry since both are one generated passage of prose.'),
	('propagate.plan', 'Propagation plan', 1.0000, 'generation',
		'docs/ux/h1-what-off-is-called.html pricing mockup: 1 credit for the candidate-identification pass. Combined with propagate.diff below, a ten-entry plan totals 1 + 10x1 = 11 credits, matching the fixture in docs/ux/f2-quota-and-cost.html and docs/ux/DECISIONS.md.'),
	('propagate.diff', 'Propagation diff, per entry', 1.0000, 'generation',
		'docs/ux/h1-what-off-is-called.html pricing mockup: 1 credit per drafted diff. See propagate.plan above for the fixture total this reproduces.'),
	('entry.complete', 'Drafted entry', 2.0000, 'generation',
		'docs/ux/h1-what-off-is-called.html pricing mockup: 2 credits, same as ask.answer - both are one full generated passage.'),
	('audit.flag', 'Audit flag draft', 1.0000, 'generation',
		'docs/ux/h1-what-off-is-called.html pricing mockup: 1 credit, a short flag-and-reason rather than a full drafted passage.'),
	('image.portrait', 'Portrait image', 3.0000, 'generation',
		'Fixture number from docs/ux/SAMPLE-WORLD.md and docs/ux/f2-quota-and-cost.html: a portrait costs 3 credits.'),
	('image.variants', 'Extra portrait variant set', 4.0000, 'generation',
		'docs/ux/h1-what-off-is-called.html pricing mockup: 4 credits for a batch of up to 4 alternates (SPEC.md §9''s flux-schnell variant picker), priced above a single portrait because it renders more images per call.'),
	('audio.layer', 'Ambient audio layer, per layer', 3.0000, 'generation',
		'Fixture number from SPEC.md §8.1 and docs/ux/SAMPLE-WORLD.md: an ambient pack costs 3 credits per generated layer.'),
	('warm.brief', 'Warm scene brief', 1.0000, 'generation',
		'docs/ux/h1-what-off-is-called.html pricing mockup: 1 credit, a short pre-computed brief (SPEC.md §8.1 warm_artifact).'),
	('warm.npc_draft', 'Warm NPC draft', 1.0000, 'generation',
		'docs/ux/h1-what-off-is-called.html pricing mockup: 1 credit, priced with warm.brief since both are pre-computed warm_artifact material rather than an on-demand answer.'),

	-- Import: charged per document extracted (SPEC.md §15).
	('import.document', 'Import extraction, per document', 0.1916, 'import',
		'Fixture number from docs/ux/SAMPLE-WORLD.md and docs/ux/d2-estimate-and-progress.html: importing 214 documents cost 41 credits, i.e. 41 / 214 = 0.1916 credits per document - only representable because credits is numeric, not an integer column.')
ON CONFLICT ("operation") DO NOTHING;
