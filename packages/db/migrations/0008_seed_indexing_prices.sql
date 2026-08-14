-- Two more reading operations at zero credits (SPEC.md §15, decision H1, issue #113).
--
-- The indexing pipeline makes two kinds of model call per chunk: an LLM pass that extracts
-- the section summary, the questions the excerpt can answer and its keywords, and a batch
-- embedding. Both are reading infrastructure: they exist so a GM can search their own
-- world, they are never triggered by a paid action, and charging for them would price the
-- thing that makes this a wiki rather than a folder.
--
-- They are still recorded at full cost to us through model_call, which is where the margin
-- question gets answered. A price row at zero is how an operation becomes free, and an
-- operation with no row at all throws, so these rows are the difference between "free" and
-- "crashes the indexer".
INSERT INTO "operation_price" ("operation", "label", "credits", "kind", "notes")
VALUES
	(
		'index.wiki.extract',
		'Wiki chunk metadata pass',
		0,
		'reading',
		'Reading is free (SPEC.md §15). One cheap LLM call per chunk to extract summary, answerable questions and keywords (§7). Recorded in model_call with its real cost.'
	),
	(
		'index.wiki.embed',
		'Wiki chunk batch embedding',
		0,
		'reading',
		'Reading is free (SPEC.md §15). Batch embedding of indexed chunks (§7, §11.3), the same rationale as index.embed.'
	)
ON CONFLICT ("operation") DO NOTHING;
