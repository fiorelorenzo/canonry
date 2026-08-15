/**
 * Renders a World into a real Obsidian vault export (SPEC.md §6.6, playbooks/obsidian.md).
 *
 * The vault is grouped by entity type into folders, one note per entity, file name is the
 * entity's `name` (what Obsidian actually does), plus a `.obsidian/` folder so
 * `detectSource` recognises it with confidence instead of falling back to the "every file
 * is Markdown" guess. Three notes are not entities at all (a template, an inbox scratch
 * file, a README) - the precision signal the obsidian playbook has to survive.
 *
 * Every syntax form playbooks/obsidian.md documents gets exercised somewhere in the
 * vault: plain wikilinks (already in `markdownBody`, untouched here), Dataview inline
 * fields, heading links, block links, alias links, and image embeds. All of it is derived
 * from the World's own relations and images, never invented content, so the gold
 * `expectRelations` stay grounded in `mentionedSlugs` + `relationsWithin` rather than a
 * second, hand-maintained list.
 */
import { deflateSync } from 'node:zlib';
import type {
	DocumentExpectation,
	Renderer,
	RenderedFile,
	World,
	WorldEntity,
	WorldEntityType
} from '../types.js';
import {
	entityBySlug,
	markdownBody,
	mentionedSlugs,
	relationKey,
	relationsWithin
} from '../types.js';

const TYPE_FOLDER: Record<WorldEntityType, string> = {
	character: 'Characters',
	place: 'Places',
	faction: 'Factions',
	item: 'Items',
	event: 'Events',
	session: 'Sessions'
};

const TYPE_TAG: Record<WorldEntityType, string> = {
	character: 'npc',
	place: 'location',
	faction: 'faction',
	item: 'item',
	event: 'event',
	session: 'session'
};

function textFile(path: string, content: string): RenderedFile {
	return { path, bytes: new TextEncoder().encode(content) };
}

function yamlList(items: string[]): string {
	if (items.length === 0) return '[]';
	const quoted = items.map((item) => `"${item.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
	return `[${quoted.join(', ')}]`;
}

// ---------------------------------------------------------------------------------------
// A minimal, dependency-free PNG encoder: a muted vignette-textured rectangle, seeded off
// the entity slug so the same World always renders the same bytes (the Renderer contract
// asks for pure, deterministic output). Stands in for an ink-and-wash portrait/map plate
// without shelling out to a browser or checking anything into the shared assets folder.
// ---------------------------------------------------------------------------------------

let crcTable: Uint32Array | undefined;

function crc32(buf: Buffer): number {
	if (!crcTable) {
		crcTable = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			crcTable[n] = c >>> 0;
		}
	}
	let crc = 0xffffffff;
	for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const typeBuf = Buffer.from(type, 'ascii');
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
	return Buffer.concat([len, typeBuf, data, crc]);
}

function seedNumber(seed: string): number {
	let h = 2166136261;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

const PLACEHOLDER_PALETTES: Array<[number, number, number]> = [
	[58, 51, 43],
	[46, 54, 58],
	[52, 46, 40],
	[40, 48, 46]
];

function placeholderPortrait(seed: string, width = 220, height = 300): Uint8Array {
	const n = seedNumber(seed);
	const base = PLACEHOLDER_PALETTES[n % PLACEHOLDER_PALETTES.length]!;
	const raw = Buffer.alloc((width * 3 + 1) * height);
	let pos = 0;
	for (let y = 0; y < height; y++) {
		raw[pos++] = 0;
		for (let x = 0; x < width; x++) {
			const dx = x / width - 0.5;
			const dy = y / height - 0.5;
			const dist = Math.sqrt(dx * dx + dy * dy);
			const vignette = Math.max(0, 1 - dist * 1.6);
			const border = x < 6 || x >= width - 6 || y < 6 || y >= height - 6 ? 0.5 : 1;
			const shade = vignette * border;
			const noise = ((n >> (x % 16)) ^ (n >> (y % 16))) & 0x0f;
			raw[pos++] = Math.min(255, Math.round(base[0] + 40 * shade + noise));
			raw[pos++] = Math.min(255, Math.round(base[1] + 45 * shade + noise));
			raw[pos++] = Math.min(255, Math.round(base[2] + 42 * shade + noise));
		}
	}
	const idat = deflateSync(raw, { level: 9 });
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	return new Uint8Array(
		Buffer.concat([
			signature,
			pngChunk('IHDR', ihdr),
			pngChunk('IDAT', idat),
			pngChunk('IEND', Buffer.alloc(0))
		])
	);
}

// ---------------------------------------------------------------------------------------
// Dataview inline fields: one per relation, hung off whichever endpoint reads naturally
// ("employer:: [[The Ashen Ledger]]" on the employee, not "employs:: [[Aldric Vane]]" on
// the employer, which would need to repeat the same key for every hire). Anything outside
// the shipped catalogue still gets a field, just keyed off its own label.
// ---------------------------------------------------------------------------------------

const DATAVIEW_KEYS: Record<string, { key: string; on: 'from' | 'to' }> = {
	commands: { key: 'commander', on: 'to' },
	employs: { key: 'employer', on: 'to' },
	'located in': { key: 'location', on: 'from' },
	'member of': { key: 'faction', on: 'from' },
	owns: { key: 'owns', on: 'from' },
	appointed: { key: 'appointed_by', on: 'to' },
	'ally of': { key: 'ally', on: 'from' },
	'parent of': { key: 'parent', on: 'to' }
};

function dataviewField(relation: {
	from: string;
	label: string;
	to: string;
}): { hostSlug: string; targetSlug: string; key: string } {
	const mapped = DATAVIEW_KEYS[relation.label];
	if (mapped) {
		return mapped.on === 'from'
			? { hostSlug: relation.from, targetSlug: relation.to, key: mapped.key }
			: { hostSlug: relation.to, targetSlug: relation.from, key: mapped.key };
	}
	return {
		hostSlug: relation.from,
		targetSlug: relation.to,
		key: relation.label
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.replace(/-/g, '_')
	};
}

interface NoteExtras {
	dataview: string[];
	notes: string[];
}

/** Builds the Dataview lines and the heading-link / block-link / alias-link sentences for
 * every entity note in one deterministic pass over the World's relations, so the vault's
 * total counts (SPEC.md §6.6's "at least six / four / two / two") come from real data
 * rather than being padded to hit a number. */
function buildExtras(world: World, entities: WorldEntity[]): Map<string, NoteExtras> {
	const bySlug = new Map<string, NoteExtras>();
	const get = (slug: string): NoteExtras => {
		let extras = bySlug.get(slug);
		if (!extras) {
			extras = { dataview: [], notes: [] };
			bySlug.set(slug, extras);
		}
		return extras;
	};

	for (const relation of world.relations) {
		const field = dataviewField(relation);
		const target = entityBySlug(world, field.targetSlug);
		get(field.hostSlug).dataview.push(`${field.key}:: [[${target.name}]]`);
	}

	const edges = world.relations.map((r) => ({ hostSlug: r.from, otherSlug: r.to }));
	const edgeAt = (i: number): { hostSlug: string; otherSlug: string } | undefined =>
		edges.length > 0 ? edges[i % edges.length] : undefined;

	for (let i = 0, placed = 0; placed < 4 && i < edges.length * 4; i++) {
		const edge = edgeAt(i);
		if (!edge) break;
		const other = entityBySlug(world, edge.otherSlug);
		const heading = other.sections[0]?.heading ?? 'Overview';
		get(edge.hostSlug).notes.push(`See [[${other.name}#${heading}]] for more.`);
		placed++;
	}

	for (let i = 0, placed = 0; placed < 2 && i < edges.length * 4; i++) {
		const edge = edgeAt(i + Math.ceil(edges.length / 2));
		if (!edge) break;
		const other = entityBySlug(world, edge.otherSlug);
		get(edge.hostSlug).notes.push(`Cross-referenced again at [[${other.name}#^${other.slug}-note]].`);
		placed++;
	}

	const aliasTargets = world.entities.filter((e) => e.aliases.length > 0);
	const usedAliasHosts = new Set<string>();
	let hostCursor = 0;
	let aliasLinksPlaced = 0;
	for (const target of aliasTargets) {
		if (aliasLinksPlaced >= 2 || entities.length < 2) break;
		let host: WorldEntity | undefined;
		for (let tries = 0; tries < entities.length; tries++) {
			const candidate = entities[(hostCursor + tries) % entities.length]!;
			if (candidate.slug !== target.slug && !usedAliasHosts.has(candidate.slug)) {
				host = candidate;
				hostCursor += tries + 1;
				break;
			}
		}
		if (!host) continue;
		usedAliasHosts.add(host.slug);
		get(host.slug).notes.push(
			`Some also call it [[${target.aliases[0]}|${target.name.toLowerCase()}]].`
		);
		aliasLinksPlaced++;
	}

	return bySlug;
}

function frontmatter(entity: WorldEntity): string {
	const tags = [TYPE_TAG[entity.type], ...entity.tags.filter((t) => t !== TYPE_TAG[entity.type])];
	return [
		'---',
		`aliases: ${yamlList(entity.aliases)}`,
		`tags: ${yamlList(tags)}`,
		`type: ${entity.type}`,
		'cssclass: canonry-note',
		'---',
		''
	].join('\n');
}

function noteBody(entity: WorldEntity, extras: NoteExtras): string {
	const lines: string[] = [`# ${entity.name}`, ''];
	if (entity.image) {
		lines.push(`![[images/${entity.image.file}]]`, '');
	}
	lines.push(markdownBody(entity));
	if (extras.dataview.length > 0) {
		lines.push('', ...extras.dataview);
	}
	if (extras.notes.length > 0) {
		lines.push('', '## Notes', '', ...extras.notes);
	}
	return `${lines.join('\n')}\n`;
}

function documentForEntity(
	world: World,
	path: string,
	entity: WorldEntity,
	body: string
): DocumentExpectation {
	const mentioned = new Set(mentionedSlugs(world, body));
	mentioned.add(entity.slug);
	const relations = relationsWithin(world, mentioned).filter(
		(r) => r.from === entity.slug || r.to === entity.slug
	);
	return {
		sourcePath: path,
		expectEntities: [entity.slug],
		expectRelations: [...new Set(relations.map(relationKey))]
	};
}

interface AuxNote {
	file: RenderedFile;
	document: DocumentExpectation;
}

function templateNote(): AuxNote {
	const path = 'Templates/Character.md';
	const content = [
		'---',
		'aliases: []',
		'tags: [template]',
		'cssclass: canonry-template',
		'---',
		'',
		'# {{title}}',
		'',
		'**Type:**',
		'**Aliases:**',
		'',
		'## Background',
		'',
		'',
		'## Allies',
		'',
		'',
		'## Notes',
		'',
		''
	].join('\n');
	return {
		file: textFile(path, content),
		document: {
			sourcePath: path,
			expectEntities: [],
			expectRelations: [],
			mustNotPropose: ['title', 'background', 'allies']
		}
	};
}

function inboxNote(): AuxNote {
	const path = 'Inbox/scratch.md';
	const content = [
		'- need to figure out who actually runs the docks now',
		'- check the dates on that harbour treaty thing again',
		"- ask the table about the captain guy? forgot his name, write it down next time",
		'- TODO sort this into the real folders',
		'- ',
		''
	].join('\n');
	return {
		file: textFile(path, content),
		document: {
			sourcePath: path,
			expectEntities: [],
			expectRelations: [],
			mustNotPropose: ['the-docks', 'the-harbour-treaty', 'the-captain-guy']
		}
	};
}

function readmeNote(world: World): AuxNote {
	const path = 'README.md';
	const content = [
		`# ${world.name} campaign vault`,
		'',
		`This vault tracks canon for ${world.name}. Real notes live under their type folders -`,
		'Characters/, Places/, Factions/, Items/, Events/, Sessions/. Templates/ holds note',
		'templates, not canon. Inbox/ is scratch space that has not been sorted yet.',
		'',
		"Maintained by the GM. Ask before editing someone else's session notes.",
		''
	].join('\n');
	return {
		file: textFile(path, content),
		document: {
			sourcePath: path,
			expectEntities: [],
			expectRelations: [],
			mustNotPropose: ['the-gm']
		}
	};
}

export const renderObsidian: Renderer = async (world) => {
	const files: RenderedFile[] = [];
	const documents: DocumentExpectation[] = [];

	const appJson = { legacyEditor: false, livePreview: true, promptDelete: false };
	files.push(textFile('.obsidian/app.json', `${JSON.stringify(appJson, null, '\t')}\n`));
	const appearanceJson = { accentColor: '', theme: 'obsidian', cssTheme: '', baseFontSize: 16 };
	files.push(
		textFile('.obsidian/appearance.json', `${JSON.stringify(appearanceJson, null, '\t')}\n`)
	);

	const entities = [...world.entities].sort((a, b) => a.slug.localeCompare(b.slug));
	const extrasBySlug = buildExtras(world, entities);

	for (const entity of entities) {
		const folder = TYPE_FOLDER[entity.type];
		const path = `${folder}/${entity.name.replace(/[\\/:*?"<>|]/g, '-')}.md`;
		const extras = extrasBySlug.get(entity.slug) ?? { dataview: [], notes: [] };
		const body = noteBody(entity, extras);
		files.push(textFile(path, `${frontmatter(entity)}${body}`));
		documents.push(documentForEntity(world, path, entity, body));

		if (entity.image) {
			files.push({
				path: `images/${entity.image.file}`,
				bytes: placeholderPortrait(entity.slug)
			});
		}
	}

	for (const extra of [templateNote(), inboxNote(), readmeNote(world)]) {
		files.push(extra.file);
		documents.push(extra.document);
	}

	files.sort((a, b) => a.path.localeCompare(b.path));
	documents.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));

	return { playbook: 'obsidian', files, documents };
};
