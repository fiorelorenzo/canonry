/**
 * The shape every corpus renderer reads and every gold expectation is derived from.
 *
 * One world, authored once, rendered into each source format SPEC.md §6.6 lists. That is
 * the whole point: an Obsidian vault, a Kanka export and a World Anvil export that
 * describe *different* worlds cannot tell you whether a playbook is worse than another
 * one, only that the fixtures differ. Here the only thing that differs between two import
 * runs is the file format, so the comparison means something.
 *
 * Nothing in this file is a product requirement. It is fixture data, the same way
 * packages/db/src/seed-fixture.ts is, and it deliberately describes the same world
 * (docs/ux/SAMPLE-WORLD.md, Valdoria Reach) so a developer reading a proposal in the
 * review UI recognises the names.
 */

/** Mirrors packages/db's entity_type enum. */
export type WorldEntityType = 'character' | 'place' | 'faction' | 'item' | 'event' | 'session';

/** SPEC.md §17: the product ships English and Italian, so the corpus does too. `mixed` is
 * an entry whose prose is genuinely half and half, which is what `detectLanguage` returns
 * null for - the honest answer, and one an importer has to survive. */
export type WorldLanguage = 'en' | 'it' | 'mixed';

export interface WorldSection {
	/** Rendered as `## heading` in Markdown, an `<h2>` in HTML, a Kanka entry heading. */
	heading: string;
	/** Markdown paragraphs. `[[Wikilink]]` mentions name other entities by their `name`,
	 * never by slug, because that is what a GM actually types. */
	body: string;
}

export interface WorldImage {
	/** File name inside `corpus/assets/`, e.g. `aldric-vane.png`. */
	file: string;
	alt: string;
}

export interface WorldEntity {
	slug: string;
	type: WorldEntityType;
	name: string;
	aliases: string[];
	language: WorldLanguage;
	/** The opening paragraph. Renderers use it as the summary/excerpt where a format has
	 * one, and it is what an extraction's `summary` field is scored against. */
	lead: string;
	sections: WorldSection[];
	/** Free-form tags, rendered as Obsidian frontmatter tags and Kanka `tags`. */
	tags: string[];
	image?: WorldImage;
	/** Kanka's own type vocabulary for this entity, e.g. `characters` -> `NPC`. Kanka
	 * exports a `type` string alongside `entity_type`, and a playbook that ignores it
	 * loses information a GM typed. */
	kankaSubtype?: string;
	/** World Anvil article template, which SPEC.md §6.8 says becomes our entity type. */
	worldAnvilTemplate?: string;
}

export interface WorldRelation {
	from: string;
	label: string;
	to: string;
	inverseLabel: string;
	cardinality: 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many';
}

export interface World {
	id: string;
	name: string;
	/** `v1` is the first export, `v2` the one the GM produces a month later. */
	revision: 'v1' | 'v2';
	entities: WorldEntity[];
	relations: WorldRelation[];
}

/** What a competent import of one document should produce. Written per rendered document
 * rather than per world, because a Kanka export puts twelve characters in one JSON file
 * and an Obsidian vault puts one character in one note: "how many entities came out of
 * this document" is only answerable against the document. */
export interface DocumentExpectation {
	sourcePath: string;
	/** Entity slugs a competent extraction produces from this document, in no order. */
	expectEntities: string[];
	/** `from|label|to` triples, slugs on both ends. A relation whose other endpoint is not
	 * in the same document is still expected: the merge engine resolves endpoints across
	 * documents, and dropping them is how a graph silently ends up with no edges. */
	expectRelations: string[];
	/** Slugs a careless extraction is likely to invent from this document and which a
	 * competent one does not: a heading that is not an entity, a person named only as a
	 * turn of phrase. The false-positive signal, the same idea as the propagation corpus's
	 * `mustNotPropose`. */
	mustNotPropose?: string[];
}

export interface RenderedFile {
	/** Path inside the export archive, forward slashes, no leading slash. */
	path: string;
	bytes: Uint8Array;
}

export interface RenderedCorpus {
	/** The playbook this export is meant to be imported with. */
	playbook: 'obsidian' | 'kanka' | 'world-anvil' | 'onenote' | 'pdf' | 'docx' | 'generic';
	files: RenderedFile[];
	documents: DocumentExpectation[];
}

export type Renderer = (world: World) => Promise<RenderedCorpus>;

export function relationKey(r: Pick<WorldRelation, 'from' | 'label' | 'to'>): string {
	return `${r.from}|${r.label}|${r.to}`;
}

/** Relations whose two endpoints both appear in the given slug set. Renderers that write
 * one document per entity use this to decide which edges that document can carry. */
export function relationsWithin(world: World, slugs: Iterable<string>): WorldRelation[] {
	const set = new Set(slugs);
	return world.relations.filter((r) => set.has(r.from) && set.has(r.to));
}

/** Relations that leave a document, i.e. one endpoint inside it and one outside. These are
 * the ones a `[[wikilink]]` in the body expresses, and the ones the merge engine has to
 * resolve on a later document. */
export function relationsLeaving(world: World, slugs: Iterable<string>): WorldRelation[] {
	const set = new Set(slugs);
	return world.relations.filter(
		(r) => (set.has(r.from) && !set.has(r.to)) || (!set.has(r.from) && set.has(r.to))
	);
}

export function entityBySlug(world: World, slug: string): WorldEntity {
	const found = world.entities.find((e) => e.slug === slug);
	if (!found) throw new Error(`no entity ${slug} in world ${world.id}`);
	return found;
}

export function entityByName(world: World, name: string): WorldEntity | undefined {
	const lowered = name.toLowerCase();
	return world.entities.find(
		(e) => e.name.toLowerCase() === lowered || e.aliases.some((a) => a.toLowerCase() === lowered)
	);
}

/** Full Markdown body of an entity: lead paragraph, then `## heading` sections. The shape
 * `packages/db`'s entity.body holds, and what every text-shaped renderer starts from. */
export function markdownBody(entity: WorldEntity): string {
	const parts = [entity.lead];
	for (const section of entity.sections) parts.push(`## ${section.heading}\n\n${section.body}`);
	return parts.join('\n\n');
}

/** Every `[[Wikilink]]` in a body, resolved to slugs against the world. Unresolvable links
 * are dropped rather than guessed: a GM's vault always has a few. */
export function mentionedSlugs(world: World, text: string): string[] {
	const out = new Set<string>();
	for (const match of text.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
		const target = entityByName(world, match[1]!.trim());
		if (target) out.add(target.slug);
	}
	return [...out];
}
