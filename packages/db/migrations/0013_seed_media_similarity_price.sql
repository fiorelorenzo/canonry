-- The similarity cache (#67, SPEC.md §9) embeds the prompt before generating, to find a
-- near-duplicate at the 0.94 threshold and avoid paying twice for the same picture. That
-- embedding is reading: it exists to prevent a charge rather than to produce anything, and
-- charging for the check would make the cheap path cost money while the expensive one is
-- the only thing priced. Free to the user, still recorded at full cost to us.
INSERT INTO "operation_price" ("operation", "label", "credits", "kind", "notes")
VALUES (
	'media.similarity_check',
	'Embedding a prompt to check the media similarity cache',
	0,
	'reading',
	'Reading is free (SPEC.md §15, decision H1). Checking for a cached duplicate before generating is what makes avoiding a double charge possible, and is not itself a generation.'
)
ON CONFLICT ("operation") DO NOTHING;
