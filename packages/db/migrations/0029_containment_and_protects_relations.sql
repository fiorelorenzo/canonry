-- Two additions to the shipped relation_type catalogue (0001_seed_relation_type_catalogue.sql),
-- universe_id null exactly like that migration, decided against issue #165's report from
-- building a 32-entity Valdoria Reach for packages/bench.
--
-- That report named four things the catalogue could not say. I am closing two of them here and
-- leaving two open, on purpose:
--
-- 1. A place inside a place - closed, with `part of`. `located in`'s allowed_from is
--    {character,faction,item,event}, deliberately excluding `place`, so Valdoria's six quarters
--    could not be inside Valdoria and the harbour could not be inside a quarter. Widening
--    `located in` to accept `place` was the smallest fix and the one I am not taking: "the
--    Lantern Quarter is located in Valdoria" and "Aldric Vane is located in the Lantern Quarter"
--    read as the same relation only because they share a label, not because they are the same
--    fact, and a propagation or an import query that follows `located in` expecting "where does a
--    person or a thing sit" would start walking into nested geography too. A new label costs one
--    row; a widened one costs a case a query has to know to strip out later. `part of` also covers
--    faction-to-faction containment (a chapter part of its parent guild) for the same reason -
--    same shape of relation, same argument against overloading `member of` (individual to faction,
--    not faction to faction) or `commands` (authority, not containment) for it. Cardinality
--    many_to_one, matching `located in`: a part sits in exactly one whole, a whole holds many
--    parts. Inverse label `contains`, reused from `located in` rather than invented fresh, because
--    from the containing entity's side "Valdoria contains the Lantern Quarter" and "Valdoria
--    contains the Gilded Rat" are both just true - the distinction that matters is the one on the
--    contained side, which the label captures. This also fixes seed-fixture.ts's own
--    `the-gilded-rat located in valdoria` row, a place starting a `located in` edge, which the
--    catalogue's own allowed_from has forbidden since 0001 - the fixture has been seeding an edge
--    illegal against its own catalogue.
--
-- 2. `protects` - closed. docs/ux/SAMPLE-WORLD.md's impact set item 7 ("Mother Sennah, relation
--    `protects` reads the wrong way round now") already assumes this label exists, and
--    apps/web/src/lib/server/onboarding.ts's KANKA_RELATION_LABELS already mints `protects` /
--    `protected by` as a per-universe type for anything imported from a Kanka export - so the name
--    and its inverse are not new, they are already load-bearing in code that has no shipped
--    catalogue row to point at. Shipping the row instead of leaving every one of those to invent
--    its own per-universe copy is the same argument 0001 makes for the other eight. Cardinality
--    many_to_many and allowed types {character,faction} -> {character,faction}, the same shape as
--    `commands` and `employs`: protection, like command, is between people and organisations, not
--    a property of places or things.
--
-- 3. Anything touching a `session` entity - left open. Not an oversight: SPEC.md's `revelation`
--    and `session_context` tables already carry a direct `session_entity_id` foreign key each
--    (packages/db/src/schema/players.ts, table.ts), which is the product's real, existing answer
--    for how a session attaches to canon. A generic relation label such as `features` would be a
--    second, competing path to the same fact, and I would be guessing at its cardinality and
--    allowed types with no real usage to point at the way `protects` has. That is a design
--    question for its own issue, with its own evidence, not a row I add here to close a checklist.
--
-- 4. An event at a place - left open, because `located in` already covers it
--    ({character,faction,item,event} -> {place} includes event on the `allowed_from` side) and
--    the report that flagged it says as much: it "reads oddly for an event but works". Not a gap.
INSERT INTO "relation_type"
	("universe_id", "label", "inverse_label", "cardinality", "allowed_from", "allowed_to")
VALUES
	(NULL, 'part of', 'contains', 'many_to_one',
		'{place,faction}'::entity_type[], '{place,faction}'::entity_type[]),
	(NULL, 'protects', 'protected by', 'many_to_many',
		'{character,faction}'::entity_type[], '{character,faction}'::entity_type[])
ON CONFLICT ("universe_id", "label") DO NOTHING;
