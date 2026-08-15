/**
 * Renders a World into the messy case SPEC.md §6.6 keeps the generic playbook around for:
 * a GM's actual notes, not a wiki export. No wikilinks, no frontmatter, no folder-per-type
 * convention - just a handful of `.txt`/`.md` files that mix several entities in one
 * document, because that is what a real session-notes dump looks like.
 *
 * Every document's `expectEntities` is exactly the set of entities this renderer actually
 * wrote prose about (tracked as the content is built, not re-derived by scanning text
 * afterwards - there is no wikilink syntax here for `mentionedSlugs` to find).
 * `expectRelations` comes from `relationsWithin` over that same set, per types.ts's own
 * guidance: a relation only counts as expressed once both of its ends are named in the
 * document.
 */
import type { DocumentExpectation, Renderer, RenderedFile, World, WorldEntity } from '../types.js';
import { relationKey, relationsWithin } from '../types.js';

function textFile(path: string, content: string): RenderedFile {
	return { path, bytes: new TextEncoder().encode(content) };
}

/** The World's own prose is authored with `[[Wikilink]]` markup (types.ts's convention for
 * every renderer to interpret); plain GM notes never carry that syntax, so every snippet
 * pulled from `lead`/`section.body` goes through here first - `[[Name]]` and `[[Name#Heading]]`
 * collapse to the bare name, `[[Name|Alias]]` keeps the alias, exactly what a person retyping
 * a wiki fact into a scratch file would leave behind. */
function plainText(text: string): string {
	const wikilink = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;
	return text.replace(wikilink, (_, name: string, alias?: string) => (alias ?? name).trim());
}

/** First sentence of an entity's lead, for a one-line mention in a GM's own notes - never
 * the whole lead, because real notes do not repeat a wiki's summary verbatim. */
function firstSentence(text: string): string {
	const plain = plainText(text);
	const period = plain.indexOf('. ');
	const cut = period === -1 ? plain.replace(/\.$/, '') : plain.slice(0, period);
	return cut.endsWith('.') ? cut : `${cut}.`;
}

function chunk<T>(items: T[], size: number): T[][] {
	const groups: T[][] = [];
	for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
	return groups;
}

function documentFor(
	world: World,
	sourcePath: string,
	entities: WorldEntity[],
	mustNotPropose?: string[]
): DocumentExpectation {
	const slugs = entities.map((e) => e.slug);
	const relations = relationsWithin(world, slugs);
	const expectation: DocumentExpectation = {
		sourcePath,
		expectEntities: slugs,
		expectRelations: [...new Set(relations.map(relationKey))]
	};
	return mustNotPropose ? { ...expectation, mustNotPropose } : expectation;
}

// ---------------------------------------------------------------------------------------
// session-notes.txt: several sessions run together in one file, a date underline standing
// in for a heading the way a plain-text app (not Markdown) would write one.
// ---------------------------------------------------------------------------------------

const SESSION_DATES = ['2026-06-02', '2026-06-16', '2026-06-30', '2026-07-14', '2026-07-30'];

function sessionNotesContent(groups: WorldEntity[][]): string {
	const blocks = groups.map((group, i) => {
		const date = SESSION_DATES[i % SESSION_DATES.length]!;
		const lines = group.map((e) => `${e.name} - ${firstSentence(e.lead)}`);
		return [date, '-'.repeat(date.length), '', ...lines].join('\n');
	});
	return `${blocks.join('\n\n')}\n`;
}

// ---------------------------------------------------------------------------------------
// npcs.txt: one line per character, Windows line endings - the file that came off someone
// else's laptop.
// ---------------------------------------------------------------------------------------

function npcsContent(characters: WorldEntity[]): string {
	const lines = characters.map((e) => `- ${e.name}: ${firstSentence(e.lead)}`);
	return `${lines.join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------------------
// A rambling place doc covering several places in one unbroken pass, no section breaks -
// the opposite of the Obsidian one-note-per-place convention.
// ---------------------------------------------------------------------------------------

function placeNotesContent(world: World, places: WorldEntity[]): string {
	const paragraph = places
		.map((place) => `${place.name}: ${firstSentence(place.lead)}`)
		.join(' Also worth remembering, ');
	const closing =
		`Still need to work out how these all connect in ${world.name}, ` +
		"but that's where things stand for now.";
	return `${paragraph}\n\n${closing}\n`;
}

// ---------------------------------------------------------------------------------------
// A bullet list of half-remembered rumours, covering whatever factions/items/events the
// notes above did not already touch.
// ---------------------------------------------------------------------------------------

function rumoursContent(entities: WorldEntity[]): string {
	const lines = entities.map((e) => `- word is: ${firstSentence(e.lead)} (${e.name})`);
	return `${lines.join('\n')}\n`;
}

export const renderGeneric: Renderer = async (world) => {
	const files: RenderedFile[] = [];
	const documents: DocumentExpectation[] = [];

	const entities = [...world.entities].sort((a, b) => a.slug.localeCompare(b.slug));
	const characters = entities.filter((e) => e.type === 'character');
	const places = entities.filter((e) => e.type === 'place');
	const factionsAndItemsAndEvents = entities.filter(
		(e) => e.type === 'faction' || e.type === 'item' || e.type === 'event'
	);

	// session-notes.txt: chunk everything that is not purely a place or a rumour-only
	// faction/item/event into groups of two, so a session pulls in whoever and wherever
	// was actually relevant that night.
	const sessionPool = entities.filter((e) => e.type === 'character' || e.type === 'session');
	const sessionCandidates = sessionPool.length > 0 ? sessionPool : entities.slice(0, 6);
	const sessionGroups = chunk(sessionCandidates, 2).slice(0, 4);
	const sessionPath = 'session-notes.txt';
	files.push(textFile(sessionPath, sessionNotesContent(sessionGroups)));
	documents.push(documentFor(world, sessionPath, sessionGroups.flat()));

	// npcs.txt: up to six characters, one line each, Windows line endings.
	const npcCast = characters.slice(0, 6);
	if (npcCast.length > 0) {
		const npcsPath = 'npcs.txt';
		files.push(textFile(npcsPath, npcsContent(npcCast)));
		documents.push(documentFor(world, npcsPath, npcCast));
	}

	// A rambling multi-place doc. Named after the first place it covers rather than a
	// fixed "lantern-quarter" filename, so the renderer stays correct for whatever place
	// entities this World actually has.
	const ramblePlaces = places.slice(0, 3);
	if (ramblePlaces.length > 0) {
		const slug = ramblePlaces[0]!.slug;
		const placePath = `${slug}-and-nearby.md`;
		files.push(textFile(placePath, placeNotesContent(world, ramblePlaces)));
		documents.push(documentFor(world, placePath, ramblePlaces));
	}

	// A rumours file for whatever factions/items/events are left uncovered.
	const rumourCast = factionsAndItemsAndEvents.slice(0, 6);
	if (rumourCast.length > 0) {
		const rumoursPath = 'faction-rumours.txt';
		files.push(textFile(rumoursPath, rumoursContent(rumourCast)));
		documents.push(documentFor(world, rumoursPath, rumourCast));
	}

	// todo.txt: pure housekeeping, yields nothing. The precision signal for this playbook.
	const todoPath = 'todo.txt';
	const todoContent = [
		'- print more character sheets',
		'- buy dice for the new player',
		'- book the table for next month',
		'- return library books',
		'- charge the laptop before next session',
		''
	].join('\n');
	files.push(textFile(todoPath, todoContent));
	documents.push({
		sourcePath: todoPath,
		expectEntities: [],
		expectRelations: [],
		mustNotPropose: ['the-new-player', 'the-table']
	});

	files.sort((a, b) => a.path.localeCompare(b.path));
	documents.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));

	return { playbook: 'generic', files, documents };
};
