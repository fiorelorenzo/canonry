import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { DocumentExpectation, RenderedFile, Renderer, WorldEntity, WorldEntityType, WorldRelation } from '../types.js';
import { relationKey } from '../types.js';

/** A 1x1 transparent PNG, used only if a world entity names an image file that has not
 * been generated yet in packages/bench/corpus/assets/ (DocRenderers' own folder - we
 * only read from it, never write into it). A real render of the finished corpus never
 * hits this fallback. */
const PLACEHOLDER_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64'
);

const ASSETS_DIR = fileURLToPath(new URL('../../../corpus/assets/', import.meta.url));

async function readAsset(file: string): Promise<Uint8Array> {
	try {
		return await readFile(ASSETS_DIR + file);
	} catch {
		return PLACEHOLDER_PNG;
	}
}

// playbooks/world-anvil.md's own template table, condensed to one representative World
// Anvil template name per Canonry type - the fallback used when an entity carries no
// `worldAnvilTemplate` of its own.
const FALLBACK_TEMPLATE: Record<WorldEntityType, string> = {
	character: 'Person',
	place: 'Settlement',
	faction: 'Organization',
	item: 'Item',
	event: 'Myth',
	session: 'Document'
};

function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function paragraphs(text: string): string[] {
	return text
		.split(/\n\n+/)
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
}

interface LinkTarget {
	slug: string;
	id: string;
	name: string;
}

// World Anvil's real content field is BBCode-ish, not Markdown: `[h2]`/`[/h2]` for
// headings, and `@[Anchor Text](article:id)` for an inter-article link (the export
// format's own syntax, not our source world's `[[Wikilink]]`). Every `[[Name]]` that
// resolves against `linksByName` becomes one of those; anything else just loses its
// brackets, the same way an unresolvable wikilink does in every other renderer here.
function bbcodeParagraph(text: string, linksByName: ReadonlyMap<string, LinkTarget>): string {
	return text.replace(/\[\[([^\]]+)\]\]/g, (_whole, name: string) => {
		const target = linksByName.get(name);
		return target ? `@[${name}](article:${target.id})` : name;
	});
}

function htmlParagraph(text: string, linksByName: ReadonlyMap<string, LinkTarget>): string {
	const withLinks = text.replace(
		/\[\[([^\]]+)\]\]/g,
		(_whole, name: string) => {
			const target = linksByName.get(name);
			return target ? `<a href="/articles/${target.slug}">${escapeHtml(name)}</a>` : escapeHtml(name);
		}
	);
	// The wikilink replacement above already escaped the linked names; escape everything
	// else by re-running on the plain segments only would double-escape the anchors, so
	// this renderer accepts prose without literal `&`/`<`/`>` outside of a link, same as
	// the rest of this fixture's authored bodies.
	return withLinks;
}

function bbcodeBody(entity: WorldEntity, linksByName: ReadonlyMap<string, LinkTarget>): string {
	const parts: string[] = [];
	for (const p of paragraphs(entity.lead)) parts.push(bbcodeParagraph(p, linksByName));
	for (const section of entity.sections) {
		parts.push(`[h2]${section.heading}[/h2]`);
		for (const p of paragraphs(section.body)) parts.push(bbcodeParagraph(p, linksByName));
	}
	return parts.join('\n\n');
}

function articleHtml(entity: WorldEntity, linksByName: ReadonlyMap<string, LinkTarget>): string {
	const parts: string[] = [`<h1>${escapeHtml(entity.name)}</h1>`];
	for (const p of paragraphs(entity.lead)) parts.push(`<p>${htmlParagraph(p, linksByName)}</p>`);
	for (const section of entity.sections) {
		parts.push(`<h2>${escapeHtml(section.heading)}</h2>`);
		for (const p of paragraphs(section.body)) parts.push(`<p>${htmlParagraph(p, linksByName)}</p>`);
	}
	return `<article>\n\t${parts.join('\n\t')}\n</article>`;
}

export const renderWorldAnvil: Renderer = async (world) => {
	const sortedSlugs = [...world.entities].map((e) => e.slug).sort();
	const articleId = (slug: string): string => `a-${slug}`;
	const linksByName = new Map<string, LinkTarget>(
		world.entities.map((e) => [e.name, { slug: e.slug, id: articleId(e.slug), name: e.name }])
	);

	// Two articles deliberately left in draft, deterministically the first two slugs -
	// World Anvil's own `isDraft` state, which a competent extraction still reads (an
	// unpublished article is still canon the GM wrote, just not shown to players yet).
	const draftSlugs = new Set(sortedSlugs.slice(0, 2));

	// One article whose template maps onto nothing in playbooks/world-anvil.md's table:
	// "Recipe" is a real World Anvil template (the Cuisine module) with no row there.
	// The playbook's own instruction for this case is "pick the closest of the six by
	// what the article actually describes ... never invent a seventh type" - so the gold
	// expectation still names this entity, typed as what it actually is in the world
	// model, not skipped.
	const unmappableSlug = [...world.entities].filter((e) => e.type === 'item').map((e) => e.slug).sort()[0];

	const files: RenderedFile[] = [];
	const documents: DocumentExpectation[] = [];
	const seenImagePaths = new Set<string>();

	for (const entity of [...world.entities].sort((a, b) => a.slug.localeCompare(b.slug))) {
		const touching: WorldRelation[] = world.relations.filter((r) => r.from === entity.slug || r.to === entity.slug);

		let imagePath: string | undefined;
		if (entity.image) {
			imagePath = `images/${entity.image.file}`;
			if (!seenImagePaths.has(imagePath)) {
				seenImagePaths.add(imagePath);
				files.push({ path: imagePath, bytes: await readAsset(entity.image.file) });
			}
		}

		const template = entity.slug === unmappableSlug ? 'Recipe' : (entity.worldAnvilTemplate ?? FALLBACK_TEMPLATE[entity.type]);
		const isDraft = draftSlugs.has(entity.slug);

		const meta = {
			id: articleId(entity.slug),
			title: entity.name,
			slug: entity.slug,
			template,
			state: isDraft ? 'draft' : 'public',
			isDraft,
			tags: entity.tags,
			excerpt: entity.lead.replace(/\[\[([^\]]+)\]\]/g, '$1').slice(0, 160),
			creationDate: '2026-06-15T00:00:00Z',
			updateDate: '2026-08-01T00:00:00Z',
			content: bbcodeBody(entity, linksByName)
		};

		files.push({
			path: `json/${entity.slug}.json`,
			bytes: new TextEncoder().encode(JSON.stringify(meta, null, '\t') + '\n')
		});
		files.push({
			path: `html/${entity.slug}.html`,
			bytes: new TextEncoder().encode(articleHtml(entity, linksByName) + '\n')
		});

		documents.push({
			sourcePath: `json/${entity.slug}.json`,
			expectEntities: [entity.slug],
			expectRelations: touching.map((r) => relationKey(r))
		});
	}

	files.push({
		path: 'world.json',
		bytes: new TextEncoder().encode(
			JSON.stringify(
				{
					id: `w-${world.id}`,
					name: world.name,
					state: 'public',
					creationDate: '2026-06-01T00:00:00Z',
					updateDate: '2026-08-01T00:00:00Z',
					categories: [...new Set(world.entities.map((e) => e.type))].sort()
				},
				null,
				'\t'
			) + '\n'
		)
	});

	return { playbook: 'world-anvil', files, documents };
};
