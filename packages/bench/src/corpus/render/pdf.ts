/**
 * The pdf playbook fixture (packages/import/playbooks/pdf.md, SPEC.md §6.6): a real PDF
 * with a genuine text layer on five pages, produced by handing real HTML to a real
 * browser rather than hand-building a content stream, plus three pages that are scans -
 * no text layer at all, each a different kind of hard - which is the whole reason
 * `page_image` and the multimodal model purpose exist (SPEC.md §6.7). One scan alone
 * only tells you whether a model can read a clean typed page; three, each degraded a
 * different way, tell you whether it can read what a GM's scanner actually produces.
 * `packages/import/src/pdf.ts` reads a page's text with pdfjs and hands back an empty
 * string for a page with no text layer; that empty string is the playbook's own signal
 * to look at the page as an image instead of text.
 *
 * The document is one "case file" from the Valdoria Reach magistrate's office: five
 * typed dossier entries, one per entity, built live from whatever `world` carries so a
 * v2 revision's names and leads still show up correctly - and three more pages dropped
 * into the same file from elsewhere: an old photostat of a typed report (page 6), a
 * second-generation photocopy of a watch incident log (page 7), and a handwritten note
 * (page 8). Each scanned page's exact wording is fixed rather than built from `world`
 * (see `SCANNED_PAGES` below): a multimodal model's transcription of it is scored
 * against that string character for character, so it cannot drift with whatever a later
 * world revision decides an entity's `lead` should say.
 */
import type { DocumentExpectation, Renderer, WorldEntity } from '../types.js';
import {
	entityBySlug,
	mentionedSlugs,
	relationKey,
	relationsLeaving,
	relationsWithin
} from '../types.js';
import { htmlToPdf, htmlToPng, mergePdfs } from './shell.js';

function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A world body is written the way a GM actually types it - `[[The Gilded Rat]]` or
 * `[[The Gilded Rat|the inn]]`. A PDF page is plain prose, so the rendered text gets the
 * display half of the link instead: the alias if there is one, otherwise the name. */
function stripWikilinks(text: string): string {
	return text.replace(/\[\[([^\]|#]+)(?:\|([^\]#]+))?(?:#[^\]]*)?\]\]/g, (_, name, alias) =>
		(alias ?? name).trim()
	);
}

function slugifyHeading(text: string): string {
	return text
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

const CASE_FILE_HEADER = "Case File - Valdoria Reach Magistrate's Office";

const DOSSIER_STYLE = `
	body { font-family: Georgia, 'Times New Roman', serif; margin: 1in; color: #1a1a1a; font-size: 12pt; line-height: 1.55; }
	h1 { font-size: 15pt; letter-spacing: 0.04em; text-transform: uppercase; margin: 0 0 0.15em; }
	.meta { font-size: 9pt; color: #555; margin: 0 0 1.6em; font-style: italic; }
	h2 { font-size: 13pt; margin-top: 1.4em; }
	h3 { font-size: 11pt; margin-top: 1.2em; text-transform: uppercase; letter-spacing: 0.03em; }
	p { margin: 0.6em 0; }
`;

/** One page of the typed case file: a fixed masthead (so every page of the same
 * document looks like it belongs to it), then one entity's lead and sections. The
 * masthead text itself is not an entity - `mustNotPropose` in the renderer below says so
 * explicitly, because "Case File" read on its own looks exactly like the kind of short
 * proper-noun-shaped phrase a careless extraction invents an entity from. */
function dossierPageHtml(entity: WorldEntity, pageNumber: number): string {
	const sections = entity.sections
		.map(
			(s) => `<h3>${escapeHtml(s.heading)}</h3>\n<p>${escapeHtml(stripWikilinks(s.body))}</p>`
		)
		.join('\n');
	return `<!doctype html>
<html><head><meta charset="utf-8"><style>${DOSSIER_STYLE}</style></head>
<body>
<h1>${escapeHtml(CASE_FILE_HEADER)}</h1>
<p class="meta">Confidential dossier. Entry ${pageNumber} of 8.</p>
<h2>Subject: ${escapeHtml(entity.name)}</h2>
<p>${escapeHtml(stripWikilinks(entity.lead))}</p>
${sections}
</body></html>`;
}

/** The typed exhibit's subject (page 6). Fixed, not picked from `world` at render time,
 * because `SCANNED_PAGES` below has to describe this one specific entity and stay right
 * about it forever - the same reason the ground truth text itself is fixed. */
const SCANNED_PAGE_SUBJECT_SLUG = 'the-gilded-rat';

/** One scanned page's exact wording, its kind of degradation, and the entities it
 * names. `text` is scored against a multimodal model's transcription character for
 * character - do not edit one without the other, and do not derive it from `world`. */
export interface ScannedPageGroundTruth {
	id: string;
	pageNumber: number;
	kind: 'typed' | 'photocopy' | 'handwritten';
	text: string;
	entities: string[];
}

/** The three scanned pages (6, 7, 8), in document order. Three different kinds of hard
 * on purpose: `typed` is a flat photostat of a typed sheet (rotation is the whole
 * problem), `photocopy` is a second-generation copy of a typed sheet (contrast and
 * speckle are the problem, not rotation), and `handwritten` is a large italic hand on
 * lined paper (the lettering itself is the problem). Each names entities `world` still
 * carries, and each names at least one entity no other page of the document mentions, so
 * a model's entity recall on the scan is measuring the scan and nothing else. */
export const SCANNED_PAGES: ScannedPageGroundTruth[] = [
	{
		id: 'the-gilded-rat-exhibit',
		pageNumber: 6,
		kind: 'typed',
		text: `${CASE_FILE_HEADER}
EXHIBIT F - PROPERTY REPORT (PHOTOSTAT)

SUBJECT: THE GILDED RAT

The Gilded Rat is an inn in the Lantern Quarter, known locally
as the Gilded Rat Tavern. Mother Sennah keeps it. The corner
seat by the stair is understood to belong to somebody, and the
watch has stopped asking who.

Aldric Vane drinks there most nights, in that same corner seat,
since he was dismissed from the Valdoria Watch.`,
		entities: ['the-gilded-rat', 'mother-sennah', 'aldric-vane', 'the-valdoria-watch']
	},
	{
		id: 'old-wharf-incident-log',
		pageNumber: 7,
		kind: 'photocopy',
		text: `${CASE_FILE_HEADER}
EXHIBIT G - WATCH INCIDENT LOG (SECOND COPY)

CASE: THE DROWNING AT THE OLD WHARF

Sera Voss took the report herself, over Bryn Oswald's
objection that the wharf was not her patrol. The body
came up under Il Molo Vecchio on the morning tide, tied
in a way the harbour master said no accident ties a rope.

The Valdoria Watch logged it as a drowning. Voss has
told nobody but Bryn Oswald what she actually thinks.`,
		entities: [
			'the-drowning-at-the-old-wharf',
			'sera-voss',
			'bryn-oswald',
			'il-molo-vecchio',
			'the-valdoria-watch'
		]
	},
	{
		id: 'ledger-collector-note',
		pageNumber: 8,
		kind: 'handwritten',
		text: `Dagny Holt came round again, asking after Ezio Conti's
ledger. She works for the Ashen Ledger and never once
raised her voice, which is somehow worse. Told her I
had not seen the Cistern Quarter books since the thaw.
She smiled and left a card anyway.`,
		entities: ['dagny-holt', 'ezio-conti', 'the-ashen-ledger', 'the-cistern-quarter']
	}
];

/** Stage one of the typed exhibit (page 6): the typed page itself, rendered as a real
 * page so it can be screenshotted into a flat image with no text layer of its own.
 * Courier, not the dossier pages' Georgia: it is meant to read as an older, separately
 * typed report someone photostatted into this file, not as one more page from the same
 * run. */
function typedPageHtml(text: string): string {
	return `<!doctype html>
<html><head><meta charset="utf-8"><style>
	html, body { margin: 0; padding: 0; background: #f4efe2; }
	.sheet { width: 816px; height: 1056px; box-sizing: border-box; padding: 100px 84px; background: #f4efe2; }
	pre { font-family: 'Courier New', Courier, monospace; font-size: 15px; line-height: 1.65; white-space: pre-wrap; color: #1c1a15; margin: 0; }
</style></head>
<body><div class="sheet"><pre>${escapeHtml(text)}</pre></div></body></html>`;
}

/** Stage one of the photocopy exhibit (page 7): the same typed-report layout as
 * `typedPageHtml`, but the paper itself already carries the wear a second-generation
 * copy has before it is ever photographed - a greyer stock and a speckle of toner noise
 * baked into the background, since there is no imagemagick on this box to add real noise
 * after the fact. The speckle is two `radial-gradient` dot tiles at different, non
 * multiple `background-size`s rather than one `repeating-radial-gradient`: a single
 * repeating radial gradient repeats as rings expanding from one point, not as a 2D
 * scatter of dots, and I only saw that once I looked at the rendered page - it read as
 * a target pattern, not paper grain. Two small tiles at offset sizes beat against each
 * other instead and give an actual uneven speckle field. */
function photocopyPageHtml(text: string): string {
	return `<!doctype html>
<html><head><meta charset="utf-8"><style>
	html, body { margin: 0; padding: 0; background: #b7b2a4; }
	.sheet {
		width: 816px; height: 1056px; box-sizing: border-box; padding: 100px 84px;
		background-color: #b7b2a4;
		background-image:
			radial-gradient(circle, rgba(40, 36, 28, 0.5) 1px, transparent 1.6px),
			radial-gradient(circle, rgba(40, 36, 28, 0.35) 0.7px, transparent 1.2px);
		background-size: 5px 5px, 7px 9px;
		background-position: 0 0, 2px 4px;
	}
	pre { font-family: 'Courier New', Courier, monospace; font-size: 15px; line-height: 1.65; white-space: pre-wrap; color: #24211b; margin: 0; }
</style></head>
<body><div class="sheet"><pre>${escapeHtml(text)}</pre></div></body></html>`;
}

/** Stage one of the handwritten note (page 8): lined paper and a large italic serif in
 * place of true cursive. I checked `fc-list` on this box for anything under script,
 * hand, cursive, comic, caveat, pacifico or dancing and found nothing, so this is the
 * honest substitute rather than a real handwriting font - the difficulty this page is
 * meant to add is a model having to work harder at the lettering, not a claim that the
 * lettering is genuinely handwritten. Line spacing is uneven by CSS `nth-child`, not by
 * a random number generator, so rebuilding the corpus produces byte-identical output. */
function handwrittenPageHtml(text: string): string {
	const lines = text
		.split('\n')
		.map((line) => `<p class="ln">${escapeHtml(line)}</p>`)
		.join('\n');
	return `<!doctype html>
<html><head><meta charset="utf-8"><style>
	html, body { margin: 0; padding: 0; }
	.sheet {
		width: 816px; height: 1056px; box-sizing: border-box; padding: 120px 90px 100px 130px;
		background-color: #f3efe4;
		background-image:
			repeating-linear-gradient(to bottom, transparent 0, transparent 47px, #b7c2d6 48px, transparent 49px),
			linear-gradient(to right, transparent 0, transparent 38px, #cf9d9d 39px, transparent 41px);
	}
	p.ln {
		font-family: 'URW Bookman', 'Bitstream Charter', Georgia, 'Times New Roman', serif;
		font-style: italic; font-size: 27px; line-height: 1.3; min-height: 1em; color: #2a2a45; margin: 0;
	}
	p.ln:nth-child(odd) { margin-top: 34px; transform: rotate(-0.5deg); }
	p.ln:nth-child(even) { margin-top: 41px; transform: rotate(0.7deg); }
	p.ln:nth-child(3n) { margin-left: 10px; }
</style></head>
<body><div class="sheet">${lines}</div></body></html>`;
}

function stagedPageHtml(page: ScannedPageGroundTruth): string {
	switch (page.kind) {
		case 'typed':
			return typedPageHtml(page.text);
		case 'photocopy':
			return photocopyPageHtml(page.text);
		case 'handwritten':
			return handwrittenPageHtml(page.text);
	}
}

interface ScanPhotoOptions {
	backgroundColor: string;
	rotateDeg: number;
	skewDeg?: number;
	filter: string;
}

/** Photograph parameters per scan kind. `typed` leans on rotation, same numbers this
 * file always used. `photocopy` leans the other way on purpose - a near-flat rotation, a
 * horizontal skew instead, a darker ground and a harder contrast/brightness drop - so
 * contrast is the problem a model has to solve, not rotation. `handwritten` stays close
 * to `typed`'s numbers since the difficulty on that page is the lettering, not the
 * photograph. */
const SCAN_PHOTO_OPTIONS: Record<ScannedPageGroundTruth['kind'], ScanPhotoOptions> = {
	typed: { backgroundColor: '#3a3a3a', rotateDeg: -2.2, filter: 'grayscale(1) contrast(0.92) brightness(0.96)' },
	photocopy: {
		backgroundColor: '#1c1c1c',
		rotateDeg: -0.4,
		skewDeg: 4.2,
		filter: 'grayscale(1) contrast(0.6) brightness(0.58)'
	},
	handwritten: { backgroundColor: '#3a3a3a', rotateDeg: 1.6, filter: 'grayscale(1) contrast(0.95) brightness(0.98)' }
};

/** Stage two of every scan: the stage-one screenshot re-embedded and photographed on a
 * dark ground so it reads as a photograph of paper rather than as paper - `opts` carries
 * the tilt, the ground colour and the filter, which is what actually varies between the
 * three kinds. Printing *this* page is what leaves it with no text layer: pdf.js sees a
 * rotated raster image, the same as it would for an actually scanned handout. */
function scannedPhotoHtml(pngBase64: string, opts: ScanPhotoOptions): string {
	const transform = `rotate(${opts.rotateDeg}deg)${opts.skewDeg ? ` skewX(${opts.skewDeg}deg)` : ''}`;
	return `<!doctype html>
<html><head><meta charset="utf-8"><style>
	html, body { margin: 0; padding: 0; background: ${opts.backgroundColor}; }
	.wrap { width: 816px; height: 1056px; display: flex; align-items: center; justify-content: center; background: ${opts.backgroundColor}; }
	img { width: 740px; filter: ${opts.filter}; transform: ${transform}; box-shadow: 0 0 30px rgba(0, 0, 0, 0.55); }
</style></head>
<body><div class="wrap"><img src="data:image/png;base64,${pngBase64}"></div></body></html>`;
}

export const renderPdf: Renderer = async (world) => {
	const pool = world.entities.filter(
		(e) => e.language !== 'it' && e.slug !== SCANNED_PAGE_SUBJECT_SLUG
	);
	const textEntities = pool.slice(0, 5);
	if (textEntities.length < 5) {
		throw new Error(
			`pdf renderer needs 5 non-Italian entities besides "${SCANNED_PAGE_SUBJECT_SLUG}", found ${textEntities.length}`
		);
	}
	// Fails loudly if a world revision drops one of the entities a scan's fixed ground
	// truth names, rather than silently shipping a document whose expectations lie.
	const scannedSlugs = [...new Set(SCANNED_PAGES.flatMap((p) => p.entities))];
	for (const slug of scannedSlugs) entityBySlug(world, slug);

	const textPdfs = await Promise.all(
		textEntities.map((entity, index) => htmlToPdf(dossierPageHtml(entity, index + 1)))
	);
	const scannedPdfs = await Promise.all(
		SCANNED_PAGES.map(async (page) => {
			const png = await htmlToPng(stagedPageHtml(page), { width: 816, height: 1056 });
			return htmlToPdf(
				scannedPhotoHtml(Buffer.from(png).toString('base64'), SCAN_PHOTO_OPTIONS[page.kind])
			);
		})
	);
	const bytes = await mergePdfs([...textPdfs, ...scannedPdfs]);

	const textSlugs = textEntities.map((e) => e.slug);
	const docSlugs = [...new Set([...textSlugs, ...scannedSlugs])];
	const docSlugSet = new Set(docSlugs);
	const rawText = textEntities
		.map((e) => [e.lead, ...e.sections.map((s) => s.body)].join('\n'))
		.join('\n');
	const mentioned = new Set(mentionedSlugs(world, rawText));
	// Same "the text has to actually say it" rule as docx.ts: a relation whose far
	// endpoint has no page of its own here is still expected if a dossier entry's own
	// prose names that endpoint.
	const leaving = relationsLeaving(world, docSlugs).filter((r) => {
		const outside = docSlugSet.has(r.from) ? r.to : r.from;
		return mentioned.has(outside);
	});
	const expectRelations = [...relationsWithin(world, docSlugs), ...leaving].map(relationKey);

	const document: DocumentExpectation = {
		sourcePath: 'players-handout.pdf',
		expectEntities: docSlugs,
		expectRelations,
		mustNotPropose: [
			slugifyHeading(CASE_FILE_HEADER),
			slugifyHeading('Exhibit F'),
			slugifyHeading('Exhibit G')
		]
	};

	return {
		playbook: 'pdf',
		files: [{ path: 'players-handout.pdf', bytes }],
		documents: [document]
	};
};
