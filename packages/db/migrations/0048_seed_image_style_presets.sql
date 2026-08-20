-- Issue #407, decision S2. The shipped image style catalogue: six presets, `universe_id`
-- left null so they read exactly like the rest of this table's shipped rows (relation_type,
-- migration 0001). Keyed by `slug` rather than a pinned id (ai-game's own migration pins
-- uuids instead, see supabase/migrations/20260710150919_seed_media_config_and_credit_costs.sql
-- in that repo) because nothing here has to match an id hardcoded elsewhere - `ON CONFLICT
-- (slug) DO UPDATE` is what makes a future edit to a preset's copy or prompt a migration that
-- updates the row in place instead of one that accumulates a duplicate next to it.
--
-- One subject, six styles: every `example_path` was generated from the same prompt
-- ("a hooded traveller studying a hand-drawn map beside a lantern-lit stone waymarker at a
-- forest crossroads, tabletop RPG scene") with only the preset's own prompt_modifier
-- appended, through black-forest-labs/flux-schnell (the product's own `variants` model,
-- packages/media/src/models.ts) called directly rather than through
-- packages/media/src/generate.ts - that path is wired to a real universe, entity and
-- operation_price charge, all of which a one-off shipped asset has none of, so reusing it
-- would have cost more machinery than it saved. See the PR for the exact script and cost.
-- Each image was downscaled to its longest edge at 400px and re-encoded as webp after
-- generation - flux-schnell's own `megapixels` input only offers "1" or "0.25", neither of
-- which lands near 400px on its own.
--
-- Names and descriptions are content, not interface: they read as prose about a specific
-- style, not as chrome around a control, so they live here and in image_style_label below
-- rather than in apps/web/src/lib/i18n's style namespace - the same split H1 already drew
-- between operation_price's admin-edited labels and the settings page's own strings, and the
-- same reasoning the shipped relation-type catalogue argues for its own locale data living in
-- @canonry/lang rather than in apps/web (packages/lang/src/relation-catalogue.ts's own doc
-- comment). The picker's chrome around them - "Custom style", "Selected", the aria labels -
-- is the interface half, and stays in en.ts/it.ts.
INSERT INTO "image_style"
	("slug", "name", "description", "prompt_modifier", "example_path", "sort_order")
VALUES
	(
		'ink-wash',
		'Ink Wash',
		'Loose ink and wash, like a plate from a sourcebook: expressive strokes, a muted parchment palette.',
		'loose ink wash illustration, visible brush strokes, muted parchment palette, tabletop RPG sourcebook style',
		'/style-examples/ink-wash.webp',
		1
	),
	(
		'woodcut',
		'Woodcut',
		'A bold monochrome engraving with heavy crosshatching, like a page torn from an old atlas.',
		'monochrome woodcut engraving, heavy crosshatching, high contrast, antique print texture',
		'/style-examples/woodcut.webp',
		2
	),
	(
		'painterly-fantasy',
		'Painterly Fantasy',
		'Rich, painterly fantasy art with dramatic light - the classic look of a hardcover setting book.',
		'painterly digital fantasy art, dramatic lighting, rich color, detailed brushwork, oil painting texture',
		'/style-examples/painterly-fantasy.webp',
		3
	),
	(
		'parchment-sketch',
		'Parchment Sketch',
		'A hand-drawn sketch on aged parchment, as if a cartographer paused to draw what they saw.',
		'pencil and ink sketch on aged parchment, cross-hatched shading, hand-drawn cartographer notebook style',
		'/style-examples/parchment-sketch.webp',
		4
	),
	(
		'stained-glass',
		'Stained Glass',
		'Bold leading and jewel-toned glass, the way a cathedral window remembers a legend.',
		'stained glass window illustration, bold black leading, jewel-toned glass panels, backlit glow',
		'/style-examples/stained-glass.webp',
		5
	),
	(
		'low-poly-diorama',
		'Low-Poly Diorama',
		'A miniature diorama rendered in clean low-poly shapes, like a painted tabletop model.',
		'low-poly 3D diorama render, simplified geometric shapes, soft studio lighting, miniature tabletop model aesthetic',
		'/style-examples/low-poly-diorama.webp',
		6
	)
ON CONFLICT ("slug") DO UPDATE SET
	"name" = excluded.name,
	"description" = excluded.description,
	"prompt_modifier" = excluded.prompt_modifier,
	"example_path" = excluded.example_path,
	"sort_order" = excluded.sort_order;
--> statement-breakpoint

-- Italian translation of the same six rows, joined back to the row this migration just
-- wrote (or updated) by slug - never by a pinned id, for the same reason the insert above
-- avoids one. `ON CONFLICT (image_style_id, locale) DO UPDATE` gives this half the same
-- re-seed-in-place guarantee as the English row it translates.
INSERT INTO "image_style_label" ("image_style_id", "locale", "name", "description")
SELECT "image_style"."id", 'it', translated.name, translated.description
FROM (
	VALUES
		('ink-wash', 'Inchiostro e Acquerello', 'Inchiostro sciolto e acquerello, come una tavola da manuale: pennellate espressive, tavolozza di pergamena smorzata.'),
		('woodcut', 'Xilografia', 'Un''incisione monocromatica marcata, dal tratteggio fitto, come una pagina strappata da un vecchio atlante.'),
		('painterly-fantasy', 'Fantasy Pittorico', 'Arte fantasy pittorica e ricca, con luce drammatica: l''aspetto classico di un manuale di ambientazione rilegato.'),
		('parchment-sketch', 'Schizzo su Pergamena', 'Uno schizzo a mano su pergamena invecchiata, come se un cartografo si fosse fermato a disegnare ciò che vedeva.'),
		('stained-glass', 'Vetrata Istoriata', 'Piombature marcate e vetri dai toni gemma, come una vetrata di cattedrale che ricorda una leggenda.'),
		('low-poly-diorama', 'Diorama Low-Poly', 'Un diorama in miniatura reso con forme low-poly pulite, come una miniatura da tavolo dipinta.')
) AS translated(slug, name, description)
JOIN "image_style" ON "image_style"."slug" = translated.slug
ON CONFLICT ("image_style_id", "locale") DO UPDATE SET
	"name" = excluded.name,
	"description" = excluded.description;
