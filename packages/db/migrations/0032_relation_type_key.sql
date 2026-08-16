-- Decision L1, issue #195: relation_type.label was doing three jobs - display word,
-- database key (unique (universe_id, label)), and the identity packages/copilot compares
-- everywhere from evidence paths to the reject signal to K1's resolver. Translating the
-- display broke all three of the others, silently, per reader locale. This splits
-- identity onto its own column.
ALTER TABLE "relation_type" ADD COLUMN "key" text DEFAULT '' NOT NULL;--> statement-breakpoint

-- The shipped catalogue's keys are API surface from the day this ships, so they are
-- hand-picked here rather than left to whatever normalization rule the trigger below
-- happens to use - a future change to that rule must never move a key out from under an
-- integration that already depends on it. They are exactly what the normalization rule
-- would have produced today (space -> underscore, lowercase), which is a property of the
-- shipped labels being simple English phrases, not a guarantee the migration relies on.
UPDATE "relation_type" SET "key" = 'commands' WHERE "universe_id" IS NULL AND "label" = 'commands';--> statement-breakpoint
UPDATE "relation_type" SET "key" = 'employs' WHERE "universe_id" IS NULL AND "label" = 'employs';--> statement-breakpoint
UPDATE "relation_type" SET "key" = 'located_in' WHERE "universe_id" IS NULL AND "label" = 'located in';--> statement-breakpoint
UPDATE "relation_type" SET "key" = 'member_of' WHERE "universe_id" IS NULL AND "label" = 'member of';--> statement-breakpoint
UPDATE "relation_type" SET "key" = 'ally_of' WHERE "universe_id" IS NULL AND "label" = 'ally of';--> statement-breakpoint
UPDATE "relation_type" SET "key" = 'parent_of' WHERE "universe_id" IS NULL AND "label" = 'parent of';--> statement-breakpoint
UPDATE "relation_type" SET "key" = 'owns' WHERE "universe_id" IS NULL AND "label" = 'owns';--> statement-breakpoint
UPDATE "relation_type" SET "key" = 'appointed' WHERE "universe_id" IS NULL AND "label" = 'appointed';--> statement-breakpoint
UPDATE "relation_type" SET "key" = 'part_of' WHERE "universe_id" IS NULL AND "label" = 'part of';--> statement-breakpoint
UPDATE "relation_type" SET "key" = 'protects' WHERE "universe_id" IS NULL AND "label" = 'protects';--> statement-breakpoint

-- Any row this migration's own UPDATEs above did not touch is a universe's own type that
-- predates this column - give it the same derivation a fresh insert gets from the trigger
-- below, once, right now, rather than leaving it stuck on the placeholder default (which
-- would collide with every other untouched row under the unique constraint two statements
-- down, since they would all still read '').
UPDATE "relation_type" SET "key" = trim(both '_' from regexp_replace(lower(trim("label")), '[^a-z0-9]+', '_', 'g')) WHERE "key" = '';--> statement-breakpoint

-- A universe's own type gets its key derived from the authored label at the moment it is
-- created, and keeps that key through every future rename - a trigger rather than
-- application-level derivation so every insert path (packages/db/src/queries/import.ts's
-- accept-vocabulary write, every test fixture that inserts a relation_type row directly)
-- gets the same rule for free instead of duplicating it per caller. `renameRelationType`
-- (packages/db/src/queries/relation-types.ts) only ever writes label/inverse_label, so it
-- never fires this - identity survives the rename it exists to protect.
CREATE OR REPLACE FUNCTION relation_type_derive_key() RETURNS trigger AS $$
BEGIN
	IF NEW.key IS NULL OR NEW.key = '' THEN
		NEW.key := trim(both '_' from regexp_replace(lower(trim(NEW.label)), '[^a-z0-9]+', '_', 'g'));
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER relation_type_derive_key_trigger
BEFORE INSERT ON "relation_type"
FOR EACH ROW EXECUTE FUNCTION relation_type_derive_key();--> statement-breakpoint

-- Rows already written carry English label text in proposal.evidence's relation paths
-- (candidates.ts's RelationEvidence.path, one label per hop). Rewrite each path entry to
-- the key of whatever relation_type currently has that exact label, scoped to the
-- proposal's own universe plus the shipped catalogue, preferring a universe-owned type
-- over a shipped one on a tie (mirrors relation-types.ts's preferUniverseOwned - a GM who
-- redefined a shipped label for their world means their own type, not the default sitting
-- behind it). A label that matches nothing live (its type was since renamed, merged away,
-- or deleted) is left as its old label text rather than guessed at: packages/copilot's
-- reject signal is a ranking hint, not a correctness guarantee (issue #195), so a stale
-- entry degrading to "resembles nothing" is acceptable; silently pointing it at the wrong
-- type is not.
DO $$
DECLARE
	rec RECORD;
	item jsonb;
	path_item jsonb;
	new_evidence jsonb;
	new_path jsonb;
	label_text text;
	mapped_key text;
BEGIN
	FOR rec IN
		SELECT id, universe_id, evidence FROM proposal
		WHERE evidence IS NOT NULL AND jsonb_typeof(evidence) = 'array'
	LOOP
		new_evidence := '[]'::jsonb;
		FOR item IN SELECT * FROM jsonb_array_elements(rec.evidence)
		LOOP
			IF item ->> 'kind' = 'relation' AND jsonb_typeof(item -> 'path') = 'array' THEN
				new_path := '[]'::jsonb;
				FOR path_item IN SELECT * FROM jsonb_array_elements(item -> 'path')
				LOOP
					label_text := path_item #>> '{}';
					SELECT rt.key INTO mapped_key
					FROM relation_type rt
					WHERE rt.label = label_text
						AND (rt.universe_id = rec.universe_id OR rt.universe_id IS NULL)
					ORDER BY rt.universe_id IS NULL ASC
					LIMIT 1;
					IF mapped_key IS NULL THEN
						new_path := new_path || to_jsonb(label_text);
					ELSE
						new_path := new_path || to_jsonb(mapped_key);
					END IF;
				END LOOP;
				item := jsonb_set(item, '{path}', new_path);
			END IF;
			new_evidence := new_evidence || jsonb_build_array(item);
		END LOOP;
		UPDATE proposal SET evidence = new_evidence WHERE id = rec.id;
	END LOOP;
END $$;--> statement-breakpoint

ALTER TABLE "relation_type" ADD CONSTRAINT "relation_type_universe_key_key" UNIQUE NULLS NOT DISTINCT("universe_id","key");