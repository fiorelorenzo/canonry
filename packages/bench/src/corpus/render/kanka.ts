import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { DocumentExpectation, RenderedFile, Renderer, WorldEntity, WorldEntityType } from '../types.js';
import { relationKey } from '../types.js';

/** A 1x1 transparent PNG, used only if a world entity names an image file that has not
 * been generated yet in packages/bench/corpus/assets/ (that folder is DocRenderers'
 * own - we only read from it, never write into it). A real render of the finished
 * corpus never hits this fallback; it exists so this renderer can be exercised on its
 * own before the asset set is complete. */
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

// Kanka's own entity_type vocabulary (app.kanka.io/api-docs/1.0/entities), the subset
// playbooks/kanka.md's table maps onto a Canonry type, one JSON file per type. `idBase`
// keeps each file's own `id` numbering in a distinct band, the same way Kanka's export
// does (characters in the 100s, locations in the 200s, and so on in our fixture).
const KANKA_FILES: ReadonlyArray<{
	file: string;
	kankaType: string;
	worldType: WorldEntityType;
	idBase: number;
	fallbackSubtype: string;
}> = [
	{ file: 'characters.json', kankaType: 'character', worldType: 'character', idBase: 100, fallbackSubtype: 'NPC' },
	{ file: 'locations.json', kankaType: 'location', worldType: 'place', idBase: 200, fallbackSubtype: 'Settlement' },
	{
		file: 'organisations.json',
		kankaType: 'organisation',
		worldType: 'faction',
		idBase: 300,
		fallbackSubtype: 'Organisation'
	},
	{ file: 'items.json', kankaType: 'item', worldType: 'item', idBase: 400, fallbackSubtype: 'Item' },
	{ file: 'events.json', kankaType: 'event', worldType: 'event', idBase: 500, fallbackSubtype: 'Event' },
	{ file: 'journals.json', kankaType: 'journal', worldType: 'session', idBase: 600, fallbackSubtype: 'Journal' }
];

function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function paragraphs(text: string): string[] {
	return text
		.split(/\n\n+/)
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
}

// Kanka's own `entry` never carries `[[Wikilink]]` markup - that is our source world's
// convention, not Kanka's. A real Kanka GM would have typed the name plain and used the
// entity picker to build the structured link instead, so the entry text just loses the
// brackets here.
function stripWikilinks(text: string): string {
	return text.replace(/\[\[([^\]]+)\]\]/g, '$1');
}

/** Kanka stores `entry` as HTML (the playbook's own words: "its HTML description"), so
 * every Markdown section becomes an `<h2>`/`<p>` pair. `connections` renders the same
 * relations the record's structured `relations` array carries again, as inline mentions
 * in prose - Kanka entries commonly say the same thing twice, once for a human reading
 * the entry and once in the structured Relations tab, and playbooks/kanka.md's own step
 * 3 says to treat an inline mention exactly like a `relations` array entry. */
function entryHtml(entity: WorldEntity, connections: ReadonlyArray<{ id: number; name: string }>): string {
	const parts: string[] = [];
	for (const p of paragraphs(entity.lead)) parts.push(`<p>${escapeHtml(stripWikilinks(p))}</p>`);
	for (const section of entity.sections) {
		parts.push(`<h2>${escapeHtml(section.heading)}</h2>`);
		for (const p of paragraphs(section.body)) parts.push(`<p>${escapeHtml(stripWikilinks(p))}</p>`);
	}
	if (connections.length > 0) {
		const links = connections
			.map((c) => `<a href="/entities/${c.id}" data-mention="entity:${c.id}">${escapeHtml(c.name)}</a>`)
			.join(', ');
		parts.push(`<p>Connections: ${links}.</p>`);
	}
	return parts.join('\n');
}

export const renderKanka: Renderer = async (world) => {
	// Global id map, derived from a sorted slug list rather than random or time-based -
	// same world in, same ids out. Kanka's own `entity_id` is unique across the whole
	// campaign (it is how a location's record names a character in its `relations`
	// array), so this map is built once, before any per-file record.
	const sortedSlugs = [...world.entities].map((e) => e.slug).sort();
	const entityIdOf = (slug: string): number => {
		const i = sortedSlugs.indexOf(slug);
		if (i === -1) throw new Error(`renderKanka: relation references unknown slug "${slug}"`);
		return 5000 + i + 1;
	};
	const nameOf = (slug: string): string => {
		const found = world.entities.find((e) => e.slug === slug);
		if (!found) throw new Error(`renderKanka: relation references unknown slug "${slug}"`);
		return found.name;
	};

	const files: RenderedFile[] = [];
	const documents: DocumentExpectation[] = [];
	const seenImagePaths = new Set<string>();

	files.push({
		path: 'info.md',
		bytes: new TextEncoder().encode(
			`kanka_version: 2.3.0\ncampaign: ${world.name}\nexported_at: 2026-08-01T00:00:00Z\n`
		)
	});

	// The one character deliberately marked `is_private`. Neither playbooks/kanka.md nor
	// the deterministic fallback driver (apps/web/src/lib/server/onboarding.ts,
	// extractKankaDocument) conditions proposing an entity on `is_private` - a GM-only
	// Kanka entity still has a name and an entry, and gets proposed like any other. It is
	// here so a playbook run can be checked against that: `is_private` is data to carry
	// through (Canonry's own `visibility` is a separate, later decision), not a signal to
	// suppress the entity on import.
	const firstCharacterSlug = [...world.entities]
		.filter((e) => e.type === 'character')
		.map((e) => e.slug)
		.sort()[0];

	for (const spec of KANKA_FILES) {
		const entities = world.entities.filter((e) => e.type === spec.worldType).sort((a, b) => a.slug.localeCompare(b.slug));

		const records = await Promise.all(
			entities.map(async (entity, index) => {
				const recordId = spec.idBase + index + 1;
				const entityId = entityIdOf(entity.slug);
				const outgoing = world.relations.filter((r) => r.from === entity.slug);
				const connections = outgoing.map((r) => ({ id: entityIdOf(r.to), name: nameOf(r.to) }));

				let imagePath: string | null = null;
				if (entity.image) {
					imagePath = `images/${entity.image.file}`;
					if (!seenImagePaths.has(imagePath)) {
						seenImagePaths.add(imagePath);
						files.push({ path: imagePath, bytes: await readAsset(entity.image.file) });
					}
				}

				return {
					id: recordId,
					entity_id: entityId,
					entity_type: spec.kankaType,
					name: entity.name,
					type: entity.kankaSubtype ?? spec.fallbackSubtype,
					entry: entryHtml(entity, connections),
					image: imagePath,
					image_full: imagePath,
					tags: entity.tags,
					is_private: entity.slug === firstCharacterSlug,
					created_at: '2026-07-01T00:00:00Z',
					updated_at: '2026-08-01T00:00:00Z',
					relations: outgoing.map((r) => ({
						target_id: entityIdOf(r.to),
						relation: r.label,
						attitude: 50
					}))
				};
			})
		);

		// One deliberately content-free record, checked into characters.json only: a
		// stub Kanka entity a GM created and never filled in. Both the real playbook and
		// the deterministic fallback still propose an entity for it (mapped type + a
		// name is the whole bar - playbooks/kanka.md never asks for a non-empty entry),
		// so it belongs in expectEntities, just with a thin summary built from nothing
		// but its name.
		if (spec.file === 'characters.json') {
			records.push({
				id: spec.idBase + records.length + 1,
				entity_id: 5000 + sortedSlugs.length + 1,
				entity_type: spec.kankaType,
				name: 'Unlabeled Contact',
				type: spec.fallbackSubtype,
				entry: '',
				image: null,
				image_full: null,
				tags: [],
				is_private: false,
				created_at: '2026-07-01T00:00:00Z',
				updated_at: '2026-08-01T00:00:00Z',
				relations: []
			});
		}

		files.push({
			path: spec.file,
			bytes: new TextEncoder().encode(JSON.stringify(records, null, '\t') + '\n')
		});

		const slugs = entities.map((e) => e.slug).concat(spec.file === 'characters.json' ? ['unlabeled-contact'] : []);
		const expectRelations = world.relations
			.filter((r) => entities.some((e) => e.slug === r.from))
			.map((r) => relationKey(r));
		documents.push({ sourcePath: spec.file, expectEntities: slugs, expectRelations });
	}

	// notes.json: Kanka's `note` entity type has no row in playbooks/kanka.md's mapping
	// table ("do not entity_propose it"), so this whole file is the "nothing mappable"
	// case step 5 tells a run to finish `skipped` on.
	const noteRecord = {
		id: 701,
		entity_id: 5701,
		entity_type: 'note',
		name: 'GM Housekeeping',
		type: 'Note',
		entry: '<p>Reminder: reconcile faction gold totals before session 8.</p>',
		image: null,
		image_full: null,
		tags: [],
		is_private: true,
		created_at: '2026-07-01T00:00:00Z',
		updated_at: '2026-08-01T00:00:00Z',
		relations: []
	};
	files.push({ path: 'notes.json', bytes: new TextEncoder().encode(JSON.stringify([noteRecord], null, '\t') + '\n') });
	documents.push({
		sourcePath: 'notes.json',
		expectEntities: [],
		expectRelations: [],
		mustNotPropose: ['gm-housekeeping']
	});

	return { playbook: 'kanka', files, documents };
};
