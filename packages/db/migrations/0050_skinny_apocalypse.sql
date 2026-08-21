-- Issue #451, round sixteen's U2 and U3. One migration for both, because both touch
-- `universe` and a script this small is easier to read as one file than two half-finished
-- ones.
--
-- U2: the Loremaster's voice grows a shipped catalogue on `image_style`'s own shape
-- (issue #407, decision S2, migrations 0047/0048) - `narration_style` plus its label
-- table, a pointer from `universe`, and the presets seeded at the bottom of this file.
--
-- U3: `universe.propagation_cap`'s column default moves from 25 to null (no limit,
-- SPEC.md §5.1, `effectiveCap` in packages/copilot/src/reject-signal.ts). This only drops
-- the DEFAULT clause - no UPDATE touches a stored value, including the many universes
-- already sitting at 25, because a migration cannot tell a default nobody chose from a cap
-- a GM set on purpose. The opposite of migration 0038, which backfilled every universe
-- to the old default when the column was born; there is no equivalent backfill here.
CREATE TABLE "narration_style" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" uuid,
	"slug" text,
	"name" text NOT NULL,
	"description" text,
	"prompt_clause" text NOT NULL,
	"example_sentence" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "narration_style_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "narration_style_label" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"narration_style_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "narration_style_label_style_locale_key" UNIQUE("narration_style_id","locale")
);
--> statement-breakpoint
ALTER TABLE "universe" ALTER COLUMN "propagation_cap" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "universe" ADD COLUMN "narration_style_id" uuid;--> statement-breakpoint
ALTER TABLE "narration_style" ADD CONSTRAINT "narration_style_universe_id_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."universe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narration_style_label" ADD CONSTRAINT "narration_style_label_narration_style_id_narration_style_id_fk" FOREIGN KEY ("narration_style_id") REFERENCES "public"."narration_style"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "narration_style_universe_idx" ON "narration_style" USING btree ("universe_id");--> statement-breakpoint
ALTER TABLE "universe" ADD CONSTRAINT "universe_narration_style_id_narration_style_id_fk" FOREIGN KEY ("narration_style_id") REFERENCES "public"."narration_style"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Carries forward whatever a GM already wrote in `loremaster_description`, before the
-- column disappears below - one custom `narration_style` row per universe that has real
-- text, `universe_id` set (never a `slug`, so it can never collide with a shipped preset
-- under the unique index just created), `name` a placeholder a GM can rename from the
-- settings picker's custom card the same way `upsertUniverseNarrationStyle` lets them
-- rename it going forward, and `prompt_clause` the old column's text verbatim (trimmed the
-- same way `setLoremasterVoice` already trimmed it on the way in, using a regex rather than
-- plain `trim()` so a description of only tabs or newlines is caught exactly like
-- `universeSetupItems`' own whitespace check treats it). A universe whose description was
-- empty or all whitespace gets no row and no pointer - the same "no voice chosen yet" state
-- `narration_style_id IS NULL` already means for a universe created after this migration.
INSERT INTO "narration_style" ("universe_id", "name", "prompt_clause")
SELECT "id", 'Custom voice', regexp_replace("loremaster_description", '^\s+|\s+$', '', 'g')
FROM "universe"
WHERE regexp_replace("loremaster_description", '^\s+|\s+$', '', 'g') <> '';
--> statement-breakpoint
UPDATE "universe" SET "narration_style_id" = "narration_style"."id"
FROM "narration_style"
WHERE "narration_style"."universe_id" = "universe"."id";
--> statement-breakpoint
ALTER TABLE "universe" DROP COLUMN "loremaster_description";
--> statement-breakpoint

-- The shipped narration catalogue: five presets that read differently out loud, not just
-- on the page - the point `listNarrationStylePresets` (queries/narration.ts) and the
-- settings picker exist for. `ON CONFLICT ("slug") DO UPDATE` gives this the same
-- re-seed-in-place guarantee migration 0048 gives the image style catalogue, for the same
-- reason: a future wording fix here is a migration that updates the row in place, not one
-- that leaves a stale duplicate beside it.
INSERT INTO "narration_style"
	("slug", "name", "description", "prompt_clause", "example_sentence", "sort_order")
VALUES
	(
		'warm-companion',
		'Warm Companion',
		'Encouraging and easy to like - the Loremaster as the friend at the table who wants everyone having a good time.',
		'Warm and encouraging, speaking like a friend at the table who wants everyone to have fun - plain words, short sentences, quick with a joke.',
		'Aldric''s not proud of it, but the watch let him go clean - no hard feelings, and he still buys the first round at the Gilded Rat.',
		1
	),
	(
		'dry-archivist',
		'Dry Archivist',
		'Terse and formal, like a filed report - no jokes, no flourishes, just the record.',
		'Dry and formal, like an archivist reading from a file: complete sentences, no embellishment, no jokes, third person throughout.',
		'Aldric Vane was dismissed from the Valdoria Watch following the events of the Sable Winter; no further disciplinary record exists.',
		2
	),
	(
		'grim-chronicler',
		'Grim Chronicler',
		'Dark and weighty, favoring dread and consequence over comfort.',
		'Grim and weighty, favoring short, ominous sentences and the language of consequence - nothing is ever simply fine.',
		'The Watch cast Aldric out after the Sable Winter, and the city has not forgiven him for surviving it.',
		3
	),
	(
		'hype-herald',
		'Hype Herald',
		'Loud and theatrical, like a tournament announcer who believes every detail is thrilling.',
		'Loud and theatrical, like a herald announcing a tournament - short punchy sentences, real enthusiasm, the occasional exclamation.',
		'Aldric Vane! Once the Watch''s own, cast out after the Sable Winter - and still standing, still drinking at the Gilded Rat!',
		4
	),
	(
		'plainspoken-neighbor',
		'Plainspoken Neighbor',
		'Casual and direct, like a local who has seen it all and tells it straight, dry humor included.',
		'Plain and conversational, like a neighbor who has lived here a while - short, direct sentences, a little dry humor, no big words when a small one works.',
		'Aldric got let go from the Watch after that whole Sable Winter mess. Still drinks at the Gilded Rat though, same corner every night.',
		5
	)
ON CONFLICT ("slug") DO UPDATE SET
	"name" = excluded.name,
	"description" = excluded.description,
	"prompt_clause" = excluded.prompt_clause,
	"example_sentence" = excluded.example_sentence,
	"sort_order" = excluded.sort_order;
--> statement-breakpoint

-- Italian translation of the same five rows, joined back by slug for the same re-seed
-- guarantee migration 0048's own translation half documents. `prompt_clause` and
-- `example_sentence` are never translated here, same as `image_style`'s `prompt_modifier`
-- and `example_path` - they are instructions and a fixed demonstration, not reader-facing
-- prose, so the model always reads the English clause regardless of the GM's own locale.
INSERT INTO "narration_style_label" ("narration_style_id", "locale", "name", "description")
SELECT "narration_style"."id", 'it', translated.name, translated.description
FROM (
	VALUES
		('warm-companion', 'Compagno Caloroso', 'Incoraggiante e simpatico - il Loremaster come l''amico al tavolo che vuole che tutti si divertano.'),
		('dry-archivist', 'Archivista Asciutto', 'Secco e formale, come un rapporto archiviato - niente battute, niente fioriture, solo i fatti.'),
		('grim-chronicler', 'Cronista Cupo', 'Buio e pesante, che preferisce la minaccia e le conseguenze al conforto.'),
		('hype-herald', 'Banditore Esaltato', 'Chiassoso e teatrale, come un banditore da torneo convinto che ogni dettaglio sia emozionante.'),
		('plainspoken-neighbor', 'Vicino Diretto', 'Casuale e diretto, come un abitante del posto che ha visto di tutto e lo racconta senza girarci intorno, con un pizzico di umorismo secco.')
) AS translated(slug, name, description)
JOIN "narration_style" ON "narration_style"."slug" = translated.slug
ON CONFLICT ("narration_style_id", "locale") DO UPDATE SET
	"name" = excluded.name,
	"description" = excluded.description;
