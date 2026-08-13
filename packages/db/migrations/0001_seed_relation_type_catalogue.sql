-- The shipped relation_type catalogue (SPEC.md §4.2). universe_id is null for every row
-- here: these are the built-in types every universe can use, distinct from a universe's
-- own custom types. Kept small and useful rather than exhaustive - a GM can add more.
INSERT INTO "relation_type"
	("universe_id", "label", "inverse_label", "cardinality", "allowed_from", "allowed_to")
VALUES
	(NULL, 'commands', 'commanded by', 'one_to_many',
		'{character,faction}'::entity_type[], '{character,faction}'::entity_type[]),
	(NULL, 'employs', 'employed by', 'one_to_many',
		'{character,faction}'::entity_type[], '{character}'::entity_type[]),
	(NULL, 'located in', 'contains', 'many_to_one',
		'{character,faction,item,event}'::entity_type[], '{place}'::entity_type[]),
	(NULL, 'member of', 'has member', 'many_to_many',
		'{character}'::entity_type[], '{faction}'::entity_type[]),
	(NULL, 'ally of', 'ally of', 'many_to_many',
		'{character,faction}'::entity_type[], '{character,faction}'::entity_type[]),
	(NULL, 'parent of', 'child of', 'one_to_many',
		'{character}'::entity_type[], '{character}'::entity_type[]),
	(NULL, 'owns', 'owned by', 'one_to_many',
		'{character,faction}'::entity_type[], '{item,place}'::entity_type[]),
	(NULL, 'appointed', 'appointed by', 'one_to_many',
		'{character,faction}'::entity_type[], '{character}'::entity_type[])
ON CONFLICT ("universe_id", "label") DO NOTHING;