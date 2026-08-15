/**
 * The docx playbook fixture (packages/import/playbooks/docx.md, SPEC.md §6.6): a real
 * Word document, produced by handing pandoc real Markdown rather than hand-building a
 * `.docx` zip. `packages/import/src/docx.ts` reads a document through mammoth, which
 * keeps headings, paragraphs, lists and tables and drops everything about how they were
 * styled - so the Markdown this file writes only needs to use the block types mammoth's
 * own extraction understands (`renderBlocks` in that file): `#`/`##` headings, `-`
 * bullets, `|`-delimited tables. A blockquote survives too, just as a plain paragraph,
 * which is the correct behaviour for a note that carries no structural meaning.
 *
 * Two documents, not one, because SPEC.md §17 means the corpus has to prove a
 * bilingual import survives: `campaign-brief.docx` for the world's English entities,
 * `guida-del-quartiere.docx` for its Italian ones. Nothing about either document's
 * shape is hand-picked for this specific world - both are built from whatever entities
 * and relations `world` actually carries, so a v2 revision with a different entity list
 * still renders correctly.
 */
import type { DocumentExpectation, Renderer, World, WorldEntity } from '../types.js';
import {
	entityBySlug,
	mentionedSlugs,
	relationKey,
	relationsLeaving,
	relationsWithin
} from '../types.js';
import { markdownToDocx } from './shell.js';

interface Locale {
	alsoKnownAsHeading: string;
	rosterHeading: (factionName: string) => string;
	nameColumnHeader: string;
	roleColumnHeader: string;
	attribution: (entityName: string) => string;
}

const EN: Locale = {
	alsoKnownAsHeading: 'Also Known As',
	rosterHeading: (factionName) => `${factionName} Roster`,
	nameColumnHeader: 'Name',
	roleColumnHeader: 'Role',
	attribution: (entityName) => `from the notes on ${entityName}`
};

const IT: Locale = {
	alsoKnownAsHeading: 'Conosciuti Anche Come',
	rosterHeading: (factionName) => `Registro di ${factionName}`,
	nameColumnHeader: 'Nome',
	roleColumnHeader: 'Ruolo',
	attribution: (entityName) => `dagli appunti su ${entityName}`
};

/** A world body is written the way a GM actually types it - `[[The Gilded Rat]]` or
 * `[[The Gilded Rat|the inn]]` - because that syntax is what `mentionedSlugs` reads.
 * Word has no notion of a wikilink, so the rendered prose gets the plain display text
 * instead: the alias half of a piped link if there is one, otherwise the name. */
function stripWikilinks(text: string): string {
	return text.replace(/\[\[([^\]|#]+)(?:\|([^\]#]+))?(?:#[^\]]*)?\]\]/g, (_, name, alias) =>
		(alias ?? name).trim()
	);
}

/** A slug in the same shape `packages/db` gives an entity, used only to name a heading
 * that is not itself an entity - the signal `mustNotPropose` checks a careless
 * extraction against. */
function slugifyHeading(text: string): string {
	return text
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/** The first faction inside this document whose roster (relations pointing at it from
 * another entity in the same document) is non-empty. Not hardcoded to any one faction's
 * slug: for the current Valdoria Reach data this lands on the Valdoria Watch, because
 * that is the only faction with an in-document member, the same way it would land on
 * whatever faction actually has members in a later revision of the world. */
function findRoster(
	world: World,
	docEntities: readonly WorldEntity[]
): { faction: WorldEntity; rows: Array<{ name: string; role: string }> } | undefined {
	const docSlugs = new Set(docEntities.map((e) => e.slug));
	for (const entity of docEntities) {
		if (entity.type !== 'faction') continue;
		const rows = world.relations
			.filter((r) => r.to === entity.slug && docSlugs.has(r.from))
			.map((r) => ({ name: entityBySlug(world, r.from).name, role: r.label }));
		if (rows.length > 0) return { faction: entity, rows };
	}
	return undefined;
}

/** Renders one entity as a `##` section: its lead paragraph, then each of its own
 * sections one level deeper. The entity name takes the `##` slot a single-entity file
 * (obsidian.ts) would give its sections, because here that slot is needed to tell one
 * entity's handout section from the next one. */
function renderEntitySection(entity: WorldEntity): string {
	const parts = [`## ${entity.name}`, stripWikilinks(entity.lead)];
	for (const section of entity.sections) {
		parts.push(`### ${section.heading}`, stripWikilinks(section.body));
	}
	return parts.join('\n\n');
}

function composeHandout(
	title: string,
	intro: string,
	epigraphEntity: WorldEntity,
	docEntities: readonly WorldEntity[],
	world: World,
	locale: Locale
): { markdown: string; mustNotProposeSlugs: string[] } {
	const mustNotProposeSlugs = [slugifyHeading(title)];
	const parts = [
		`# ${title}`,
		intro,
		`> ${stripWikilinks(epigraphEntity.lead)}\n>\n> — ${locale.attribution(epigraphEntity.name)}`,
		...docEntities.map(renderEntitySection)
	];

	const aliased = docEntities.filter((e) => e.aliases.length > 0);
	if (aliased.length > 0) {
		mustNotProposeSlugs.push(slugifyHeading(locale.alsoKnownAsHeading));
		const bullets = aliased.map((e) => `- **${e.name}**: ${e.aliases.join(', ')}`).join('\n');
		parts.push(`## ${locale.alsoKnownAsHeading}`, bullets);
	}

	const roster = findRoster(world, docEntities);
	if (roster) {
		const heading = locale.rosterHeading(roster.faction.name);
		mustNotProposeSlugs.push(slugifyHeading(heading));
		const header = `| ${locale.nameColumnHeader} | ${locale.roleColumnHeader} |`;
		const divider = '| --- | --- |';
		const rows = roster.rows.map((r) => `| ${r.name} | ${r.role} |`);
		parts.push(`## ${heading}`, [header, divider, ...rows].join('\n'));
	}

	return { markdown: parts.join('\n\n') + '\n', mustNotProposeSlugs };
}

async function renderHandoutDocument(
	path: string,
	title: string,
	intro: string,
	docEntities: readonly WorldEntity[],
	world: World,
	locale: Locale
): Promise<{ file: { path: string; bytes: Uint8Array }; expectation: DocumentExpectation }> {
	const epigraphEntity = docEntities[0];
	if (!epigraphEntity) throw new Error(`docx renderer: "${path}" has no entities to render`);
	const { markdown, mustNotProposeSlugs } = composeHandout(
		title,
		intro,
		epigraphEntity,
		docEntities,
		world,
		locale
	);
	const bytes = await markdownToDocx(markdown);
	const docSlugs = docEntities.map((e) => e.slug);
	const docSlugSet = new Set(docSlugs);
	const rawText = docEntities
		.map((e) => [e.lead, ...e.sections.map((s) => s.body)].join('\n'))
		.join('\n');
	const mentioned = new Set(mentionedSlugs(world, rawText));
	// A relation the document only half-contains still counts, but only when the text
	// actually names the far side - `relationsLeaving` finds the edge, `mentioned`
	// confirms this document's own prose is what would surface it to an importer.
	const leaving = relationsLeaving(world, docSlugs).filter((r) => {
		const outside = docSlugSet.has(r.from) ? r.to : r.from;
		return mentioned.has(outside);
	});
	const expectRelations = [...relationsWithin(world, docSlugs), ...leaving].map(relationKey);
	return {
		file: { path, bytes },
		expectation: {
			sourcePath: path,
			expectEntities: docSlugs,
			expectRelations,
			...(mustNotProposeSlugs.length > 0 ? { mustNotPropose: mustNotProposeSlugs } : {})
		}
	};
}

const EN_INTRO =
	"GM's notes for the table, Lantern Quarter first. Keep the loose pages out of player hands until they stop being secrets.";

const IT_INTRO =
	'Appunti del narratore per le voci italiane della campagna. I nomi propri restano come sono scritti qui, senza tradurli.';

export const renderDocx: Renderer = async (world) => {
	const enEntities = world.entities.filter((e) => e.language !== 'it');
	const itEntities = world.entities.filter((e) => e.language === 'it');

	const documents: DocumentExpectation[] = [];
	const files: Array<{ path: string; bytes: Uint8Array }> = [];

	if (enEntities.length > 0) {
		const built = await renderHandoutDocument(
			'campaign-brief.docx',
			'Campaign Brief: Valdoria Reach',
			EN_INTRO,
			enEntities,
			world,
			EN
		);
		files.push(built.file);
		documents.push(built.expectation);
	}

	if (itEntities.length > 0) {
		const built = await renderHandoutDocument(
			'guida-del-quartiere.docx',
			'Guida del Quartiere della Lanterna',
			IT_INTRO,
			itEntities,
			world,
			IT
		);
		files.push(built.file);
		documents.push(built.expectation);
	}

	return { playbook: 'docx', files, documents };
};
