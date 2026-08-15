/**
 * Renders a World into a folder tree of exported OneNote pages (SPEC.md §6.6, §6.10,
 * packages/import/playbooks/onenote.md): `notebook/section/page.htm`, a subpage living in
 * a directory named after its parent page, and an embedded attachment living in a sibling
 * `<page>_files/` directory - the shape `meichthys/onenote-html-export` produces, mirrored
 * from `packages/import/test/fixtures/onenote/export/`.
 *
 * Renders with its own `onenote` playbook id (issue #162): `apps/web/src/lib/server/
 * onboarding.ts`'s `detectSource` recognises this shape from the `.htm` tree plus its
 * sibling `_files/` folders, and `documentsForPlaybook` enumerates one document per page.
 * `documents` below lists exactly those pages, each with the entity `onenote.md` proposes
 * for it and, where the page is a subpage, the "subpage of" relation the folder nesting
 * implies - the one relation this renderer can promise without guessing at a verb an
 * in-body link's bare "See X." sentence never states.
 */
import type { DocumentExpectation, Renderer, RenderedFile, World, WorldEntity } from '../types.js';
import { markdownBody, relationKey, relationsWithin } from '../types.js';
import { deflateSync } from 'node:zlib';

function textFile(path: string, content: string): RenderedFile {
	return { path, bytes: new TextEncoder().encode(content) };
}

function sanitizeFileName(name: string): string {
	return name.replace(/[\\/:*?"<>|]/g, '-');
}

/** Same conversion generic.ts uses: the World's prose carries `[[Wikilink]]` markup for
 * every renderer to interpret, and OneNote's own export is plain paragraph text - a real
 * `<a href>` gets added separately, from actual export-relative links, not from this. */
function plainText(text: string): string {
	const wikilink = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;
	return text.replace(wikilink, (_, name: string, alias?: string) => (alias ?? name).trim());
}

// ---------------------------------------------------------------------------------------
// The same dependency-free PNG placeholder obsidian.ts uses, duplicated rather than
// shared: each renderer file exports exactly one `Renderer` and nothing else.
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
// Page placement: each chosen entity is either a top-level page directly under the
// section, or a subpage living in a directory named after its parent page.
// ---------------------------------------------------------------------------------------

interface PageLocation {
	entity: WorldEntity;
	fileBase: string;
	/** '' for a top-level page, the parent's `fileBase` for a subpage. */
	parentFileBase: string;
}

function hrefBetween(from: PageLocation, to: PageLocation): string {
	if (from.parentFileBase === '' && to.parentFileBase === '') return `${to.fileBase}.htm`;
	if (from.parentFileBase === '' && to.parentFileBase !== '') {
		return `${to.parentFileBase}/${to.fileBase}.htm`;
	}
	if (from.parentFileBase !== '' && to.parentFileBase === '') return `../${to.fileBase}.htm`;
	return from.parentFileBase === to.parentFileBase
		? `${to.fileBase}.htm`
		: `../${to.parentFileBase}/${to.fileBase}.htm`;
}

/** OneNote's own export style: absolutely positioned divs, `MsoNormal` paragraphs, an
 * inline `<span style="font-family:...">` per run - the "ugly inline-styled HTML" real
 * OneNote produces, not the clean minimal fixture this renderer's own test siblings use. */
function pageHtml(
	location: PageLocation,
	links: Array<{ href: string; label: string }>,
	imageFile: string | undefined
): string {
	const paragraphs = markdownBody(location.entity)
		.split(/\n\n+/)
		.filter((p) => !p.startsWith('## '))
		.map((p) => plainText(p.replace(/\n/g, ' ')));

	const linkSentence =
		links.length > 0
			? ` ${links.map((l) => `See <a href="${l.href}">${l.label}</a>.`).join(' ')}`
			: '';

	const bodyParagraphs = paragraphs
		.map(
			(p, i) =>
				`<p class=MsoNormal><span style='font-family:"Calibri",sans-serif;font-size:11.0pt'>${p}${
					i === paragraphs.length - 1 ? linkSentence : ''
				}</span></p>`
		)
		.join('\n');

	const attachment = imageFile ? `${sanitizeFileName(location.entity.name)}_files/${imageFile}` : '';
	const img = imageFile
		? `\n<p class=MsoNormal><img src="${attachment}" width=220 height=300></p>`
		: '';

	return `<html xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta http-equiv=Content-Type content="text/html; charset=utf-8">
<title>${location.entity.name}</title>
<meta name=Generator content="Microsoft OneNote 15">
<style>
p.MsoNormal, li.MsoNormal, div.MsoNormal
	{margin:0in;
	font-size:11.0pt;
	font-family:"Calibri",sans-serif;}
</style>
</head>
<body lang=EN-US style='word-wrap:break-word'>
<div style="position:absolute;left:48px;top:115px;width:576px">
${bodyParagraphs}${img}
</div>
</body>
</html>
`;
}

export const renderOneNote: Renderer = async (world) => {
	const files: RenderedFile[] = [];

	// Prefer the most-connected entities, so the export's cross-page links and its one or
	// two parent/subpage pairs are grounded in real relations rather than picked cold.
	const degree = new Map<string, number>();
	for (const r of world.relations) {
		degree.set(r.from, (degree.get(r.from) ?? 0) + 1);
		degree.set(r.to, (degree.get(r.to) ?? 0) + 1);
	}
	const byDegreeThenSlug = (a: WorldEntity, b: WorldEntity): number =>
		(degree.get(b.slug) ?? 0) - (degree.get(a.slug) ?? 0) || a.slug.localeCompare(b.slug);
	const pageEntities = [...world.entities].sort(byDegreeThenSlug).slice(0, 10);
	const pageSlugs = new Set(pageEntities.map((e) => e.slug));

	// Up to two subpage pairs, picked from relations that stay inside the chosen page set,
	// each entity used as parent or child at most once.
	const used = new Set<string>();
	const subpagePairs: Array<{ parent: WorldEntity; child: WorldEntity }> = [];
	for (const r of relationsWithin(world, pageSlugs)) {
		if (subpagePairs.length >= 2) break;
		if (used.has(r.from) || used.has(r.to)) continue;
		const parent = pageEntities.find((e) => e.slug === r.from)!;
		const child = pageEntities.find((e) => e.slug === r.to)!;
		subpagePairs.push({ parent, child });
		used.add(r.from);
		used.add(r.to);
	}
	// Bidirectional: neither the child nor the parent repeats the folder-structural
	// relation as an in-body link - onenote.md is explicit that link has no sentence of
	// prose behind it, the folder tree alone is the evidence.
	const structuralPartnerOf = new Map<string, string>();
	for (const pair of subpagePairs) {
		structuralPartnerOf.set(pair.child.slug, pair.parent.slug);
		structuralPartnerOf.set(pair.parent.slug, pair.child.slug);
	}

	const notebook = sanitizeFileName(`${world.name} Campaign`);
	const section = 'Handouts';

	const locations = new Map<string, PageLocation>();
	for (const entity of pageEntities) {
		const pair = subpagePairs.find((p) => p.child.slug === entity.slug);
		locations.set(entity.slug, {
			entity,
			fileBase: sanitizeFileName(entity.name),
			parentFileBase: pair ? sanitizeFileName(pair.parent.name) : ''
		});
	}

	const documents: DocumentExpectation[] = [];
	for (const entity of pageEntities) {
		const location = locations.get(entity.slug)!;
		const dir = location.parentFileBase
			? `${notebook}/${section}/${location.parentFileBase}`
			: `${notebook}/${section}`;
		// In-body links: relations inside the page set that are not the structural
		// parent/subpage pairing already encoded by the folder itself.
		const structuralPartner = structuralPartnerOf.get(entity.slug);
		const relatedLinks = relationsWithin(world, pageSlugs)
			.filter((r) => r.from === entity.slug || r.to === entity.slug)
			.filter((r) => {
				const otherSlug = r.from === entity.slug ? r.to : r.from;
				return otherSlug !== structuralPartner;
			})
			.slice(0, 2)
			.map((r) => {
				const otherSlug = r.from === entity.slug ? r.to : r.from;
				const other = locations.get(otherSlug)!;
				return { href: hrefBetween(location, other), label: other.entity.name };
			});

		const imageFile = entity.image?.file;
		const html = pageHtml(location, relatedLinks, imageFile);
		const sourcePath = `${dir}/${location.fileBase}.htm`;
		files.push(textFile(sourcePath, html));
		if (imageFile && entity.image) {
			files.push({
				path: `${dir}/${location.fileBase}_files/${imageFile}`,
				bytes: placeholderPortrait(entity.slug)
			});
		}

		// onenote.md step 3: only the subpage proposes "subpage of" - a page never proposes
		// a relation to its own children, so this is the one relation a competent read of
		// this page alone can promise without guessing at the verb an in-body link's bare
		// "See X." sentence never states (onenote.md's own fallback for that case is
		// "mentions" / "mentioned by", deliberately left out of expectRelations here since
		// no bench task scores a OneNote document yet).
		const pair = subpagePairs.find((p) => p.child.slug === entity.slug);
		documents.push({
			sourcePath,
			expectEntities: [entity.slug],
			expectRelations: pair
				? [relationKey({ from: entity.slug, label: 'subpage of', to: pair.parent.slug })]
				: []
		});
	}

	files.sort((a, b) => a.path.localeCompare(b.path));
	documents.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));

	return { playbook: 'onenote', files, documents };
};
