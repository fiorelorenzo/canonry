-- Issue #796: the narration style picker's example sentence was always English, even
-- when the picker itself had already translated the preset's name and description
-- (`narration_style_label`, migration 0050). This gives that table the same column for
-- the sample, nullable like every other locale field here, so `listNarrationStylePresets`
-- (queries/narration.ts) can coalesce it exactly the way it already coalesces name and
-- description - falling back to the shipped English sentence when a locale has no
-- translated one, never to nothing.
ALTER TABLE "narration_style_label" ADD COLUMN "example_sentence" text;
--> statement-breakpoint

-- Italian translations of the five shipped presets' example sentences, joined back by
-- slug the same way migration 0050's own translation insert is - `ON CONFLICT DO UPDATE`
-- only touches `example_sentence`, so a name/description already translated stays
-- untouched here, and a future wording fix updates the row in place rather than leaving
-- a stale duplicate beside it.
INSERT INTO "narration_style_label" ("narration_style_id", "locale", "name", "description", "example_sentence")
SELECT
	"narration_style"."id",
	'it',
	coalesce(existing.name, "narration_style"."name"),
	coalesce(existing.description, "narration_style"."description"),
	translated.example_sentence
FROM (
	VALUES
		(
			'warm-companion',
			'Aldric non ne va fiero, ma la guardia lo ha lasciato andare pulito - nessun rancore, e offre ancora il primo giro al Ratto Dorato.'
		),
		(
			'dry-archivist',
			'Aldric Vane è stato congedato dalla Guardia di Valdoria in seguito agli eventi dell''Inverno Sabbia; non risultano ulteriori annotazioni disciplinari.'
		),
		(
			'grim-chronicler',
			'La Guardia ha cacciato Aldric dopo l''Inverno Sabbia, e la città non gli ha mai perdonato di esserne sopravvissuto.'
		),
		(
			'hype-herald',
			'Aldric Vane! Un tempo uomo della Guardia, cacciato dopo l''Inverno Sabbia - e ancora in piedi, ancora a bere al Ratto Dorato!'
		),
		(
			'plainspoken-neighbor',
			'Aldric è stato cacciato dalla Guardia dopo tutto quel casino dell''Inverno Sabbia. Beve ancora al Ratto Dorato, però, stesso angolo ogni sera.'
		)
) AS translated(slug, example_sentence)
JOIN "narration_style" ON "narration_style"."slug" = translated.slug
LEFT JOIN "narration_style_label" AS existing
	ON existing."narration_style_id" = "narration_style"."id" AND existing."locale" = 'it'
ON CONFLICT ("narration_style_id", "locale") DO UPDATE SET
	"example_sentence" = excluded.example_sentence;