#!/usr/bin/env node
/**
 * Builds a real-world demo import corpus from a directory of markdown notes (issue #257).
 *
 * Canonry's own bench corpus (`packages/bench/src/corpus`) renders a world we wrote
 * ourselves, because a benchmark needs known gold. What it cannot show is how the
 * importer copes with prose nobody wrote for it. This script takes an existing markdown
 * vault and produces two archives that exercise that:
 *
 *   1. A OneNote page export, in exactly the tree `packages/import/playbooks/onenote.md`
 *      reads: `notebook/section/page.htm`, a subpage in a folder named after its parent,
 *      an attachment in a sibling `<page>_files/` folder, in-body links as real
 *      export-relative `<a href>`. The HTML is deliberately as ugly as OneNote's own
 *      export - absolutely positioned divs, `MsoNormal` paragraphs, an inline
 *      `font-family` span per run - the same style `packages/bench/src/corpus/render/
 *      onenote.ts` already produces for the synthetic bench world; this script reuses
 *      that same approach (including its dependency-free PNG placeholder generator,
 *      duplicated rather than imported for the reason its own comment gives: nothing in
 *      that file is exported except the one `Renderer`) but drives it from real files on
 *      disk instead of a synthetic `World` object.
 *   2. The same source zipped as a plain Obsidian vault: the notes copied verbatim (no
 *      conversion - `apps/web/src/lib/server/onboarding.ts`'s `detectSource` only checks
 *      for a `.obsidian` path segment) plus a minimal `.obsidian/` folder.
 *
 * Source content for the actual demo run (see `runValdris` below): Valdris
 * (https://github.com/offendingcommit/valdris), 80 interlinked worldbuilding notes
 * written by offendingcommit and the project's contributors. Its README.md and
 * CONTRIBUTING.md both state, repeatedly and explicitly, that the content is licensed
 * CC BY-SA 4.0 (Creative Commons Attribution-ShareAlike 4.0 International) - the
 * `LICENSE` both documents link to does not actually exist in the repository (checked
 * against a local clone and the GitHub API, both empty) - so what's authoritative here
 * is the vault's own repeated statement of the terms it publishes under, not a missing
 * file. A CC BY-SA text corpus is share-alike and does not belong inside this AGPL-3.0
 * repository, so the rendered archives are never committed: they land in the gitignored
 * `.data/` at the worktree root (already covered by the root `.gitignore`), and this
 * script - not the corpus it consumes - is what gets committed.
 *
 * Usage:
 *   node scripts/build-demo-corpus.mjs <sourceDir> [--limit 14] [--out .data]
 *                                       [--pages "a.md|b/c.md"] [--seed a.md]
 *
 * `<sourceDir>` is any directory of markdown notes with relative markdown links between
 * them (plain `[label](path.md)` or Obsidian's short vault-wide filename links both
 * resolve). Without `--pages`, the script picks a connected, densely cross-linked subset
 * of `--limit` notes on its own (see `selectPages`): a demo import needs entities that
 * link to each other, not the first N notes alphabetically, and a live import processes
 * documents serially at roughly twelve seconds each (`packages/import/src/
 * job-runner.ts`'s `for (const doc of params.documents)` loop), so eighty notes is not a
 * demo. `--pages` overrides the automatic pick with an explicit, pipe-separated list of
 * source-relative paths for a caller (a human who has read the corpus, or another script)
 * who already knows which notes tell a coherent story - the run below uses it because a
 * regional slice (a region, its settlements, the ruins and NPCs in them) reads better as
 * a demo than whatever a page-rank-style heuristic reaches for in a small, richly
 * cross-referenced wiki where nearly every page cites the setting's handful of
 * world-spanning lore pages.
 */

import { readFile, readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// -----------------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------------

function parseArgs(argv) {
	const args = { sourceDir: undefined, limit: 14, out: path.join(REPO_ROOT, '.data'), pages: undefined, seed: undefined };
	const positionals = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--limit') args.limit = Number(argv[++i]);
		else if (a === '--out') args.out = path.resolve(argv[++i]);
		else if (a === '--pages') args.pages = argv[++i];
		else if (a === '--seed') args.seed = argv[++i];
		else positionals.push(a);
	}
	if (positionals.length !== 1) {
		throw new Error('usage: build-demo-corpus.mjs <sourceDir> [--limit 14] [--out .data] [--pages "a.md|b.md"] [--seed a.md]');
	}
	args.sourceDir = path.resolve(positionals[0]);
	if (!Number.isInteger(args.limit) || args.limit < 2) throw new Error('--limit must be an integer >= 2');
	return args;
}

// -----------------------------------------------------------------------------------
// Vault walk and title extraction
// -----------------------------------------------------------------------------------

const EXCLUDED_DIRS = new Set(['.git', '.github', '.obsidian', 'node_modules', 'overrides']);
const NON_NOTE_ROOT_FILE = /^(README|CONTRIBUTING|CHANGELOG|LICENSE)(\.|$)/i;

async function walkMarkdownFiles(sourceDir) {
	const out = [];
	async function walk(dir) {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name.startsWith('.') && entry.isDirectory()) continue;
			if (EXCLUDED_DIRS.has(entry.name)) continue;
			const abs = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(abs);
			} else if (entry.isFile() && /\.md$/i.test(entry.name) && !NON_NOTE_ROOT_FILE.test(entry.name)) {
				out.push(path.relative(sourceDir, abs).split(path.sep).join('/'));
			}
		}
	}
	await walk(sourceDir);
	out.sort();
	return out;
}

function extractTitle(raw, relPath) {
	const h1 = /^#\s+(.+)$/m.exec(raw);
	if (h1) return h1[1].trim();
	return path.posix.basename(relPath, '.md');
}

async function loadNotes(sourceDir, relPaths) {
	const notes = new Map();
	for (const relPath of relPaths) {
		const raw = await readFile(path.join(sourceDir, ...relPath.split('/')), 'utf8');
		notes.set(relPath, { relPath, title: extractTitle(raw, relPath), raw });
	}
	return notes;
}

// -----------------------------------------------------------------------------------
// Link resolution: `[label](path.md)`, percent-encoded, resolved relative to the
// linking file first and, when that misses, against a vault-wide unique-basename index -
// the same short-path resolution Obsidian itself does, and how this corpus's own links
// (many of them bare filenames from a note in a different folder) actually resolve.
// -----------------------------------------------------------------------------------

const MD_LINK = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;

function normalizeRelPath(fromDir, decodedHref) {
	const parts = path.posix.normalize(path.posix.join(fromDir, decodedHref)).split('/');
	const out = [];
	for (const part of parts) {
		if (part === '..') out.pop();
		else if (part !== '.' && part !== '') out.push(part);
	}
	return out.join('/');
}

function buildBasenameIndex(notes) {
	const basenameIndex = new Map();
	for (const relPath of notes.keys()) {
		const stem = path.posix.basename(relPath, '.md');
		if (!basenameIndex.has(stem)) basenameIndex.set(stem, []);
		basenameIndex.get(stem).push(relPath);
	}
	return basenameIndex;
}

/** Resolves one `[label](href)` target against the file that contains it: relative to
 * `fromDir` first, then - when that path is not one of this vault's own notes - by a
 * vault-wide unique-basename match, the same short-path resolution Obsidian itself
 * does and how many of this corpus's own links (bare filenames written from a note in
 * a different folder) actually resolve. Returns `undefined` for anything external, a
 * fragment-only link, a non-`.md` target, or an ambiguous/missing basename. */
function resolveMdHref(fromDir, href, notes, basenameIndex) {
	if (/^[a-z]+:\/\//i.test(href)) return undefined;
	const withoutFragment = href.split('#')[0];
	if (!withoutFragment || !/\.md$/i.test(withoutFragment)) return undefined;
	let decoded;
	try {
		decoded = decodeURIComponent(withoutFragment);
	} catch {
		decoded = withoutFragment;
	}
	const relative = normalizeRelPath(fromDir, decoded);
	if (notes.has(relative)) return relative;
	const stem = path.posix.basename(decoded, '.md');
	const candidates = basenameIndex.get(stem);
	return candidates && candidates.length === 1 ? candidates[0] : undefined;
}

function buildLinkGraph(notes) {
	const basenameIndex = buildBasenameIndex(notes);
	const graph = new Map();
	for (const [relPath, note] of notes) {
		const targets = new Set();
		const fromDir = path.posix.dirname(relPath);
		for (const m of note.raw.matchAll(MD_LINK)) {
			const resolved = resolveMdHref(fromDir, m[2], notes, basenameIndex);
			if (resolved && resolved !== relPath) targets.add(resolved);
		}
		graph.set(relPath, targets);
	}
	return { graph, basenameIndex };
}

function undirectedFrom(graph) {
	const adj = new Map();
	const add = (a, b) => {
		if (!adj.has(a)) adj.set(a, new Set());
		adj.get(a).add(b);
	};
	for (const [src, targets] of graph) {
		for (const t of targets) {
			add(src, t);
			add(t, src);
		}
	}
	const degree = new Map();
	for (const [node, neighbours] of adj) degree.set(node, neighbours.size);
	return { adj, degree };
}

// -----------------------------------------------------------------------------------
// Page selection: an explicit `--pages` list (validated connected), or an automatic
// greedy pick that reserves one thin/housekeeping page and grows a connected cluster
// for the rest.
// -----------------------------------------------------------------------------------

const HOUSEKEEPING_PATTERN = /report|index|changelog|todo|missing.*link/i;
const GENERATED_MARKER = /generated (on|automatically)/i;

function isHousekeeping(note) {
	return HOUSEKEEPING_PATTERN.test(note.title) || HOUSEKEEPING_PATTERN.test(note.relPath) || GENERATED_MARKER.test(note.raw);
}

function assertConnected(pages, adj) {
	const set = new Set(pages);
	const seen = new Set();
	const stack = [pages[0]];
	while (stack.length > 0) {
		const n = stack.pop();
		if (seen.has(n)) continue;
		seen.add(n);
		for (const neighbour of adj.get(n) ?? []) {
			if (set.has(neighbour) && !seen.has(neighbour)) stack.push(neighbour);
		}
	}
	const missing = pages.filter((p) => !seen.has(p));
	if (missing.length > 0) {
		throw new Error(`--pages is not one connected set: ${missing.join(', ')} share no resolved link with the rest`);
	}
}

function selectPages({ notes, adj, degree, limit, seed, explicitPages }) {
	if (explicitPages) {
		const pages = explicitPages.split('|').map((p) => p.trim()).filter(Boolean);
		for (const p of pages) {
			if (!notes.has(p)) throw new Error(`--pages names "${p}", which is not a markdown file under the source directory`);
		}
		assertConnected(pages, adj);
		return pages;
	}

	const all = [...notes.keys()];
	const housekeepingCandidates = all.filter((p) => isHousekeeping(notes.get(p)));
	const housekeepingPick =
		housekeepingCandidates.length > 0
			? housekeepingCandidates.reduce((a, b) => ((degree.get(a) ?? 0) <= (degree.get(b) ?? 0) ? a : b))
			: undefined;

	const growthTarget = housekeepingPick ? limit - 1 : limit;
	const pool = all.filter((p) => p !== housekeepingPick);
	const clusterSeed =
		seed ??
		pool.reduce((a, b) => ((degree.get(b) ?? 0) > (degree.get(a) ?? 0) ? b : a));
	if (!pool.includes(clusterSeed)) throw new Error(`--seed names "${clusterSeed}", which is not eligible for selection`);

	const selected = [clusterSeed];
	const selectedSet = new Set(selected);
	while (selected.length < growthTarget) {
		let best;
		let bestScore = [-1, -1];
		for (const cand of pool) {
			if (selectedSet.has(cand)) continue;
			const hits = [...(adj.get(cand) ?? [])].filter((n) => selectedSet.has(n)).length;
			const score = [hits, degree.get(cand) ?? 0];
			if (score[0] > bestScore[0] || (score[0] === bestScore[0] && score[1] > bestScore[1])) {
				best = cand;
				bestScore = score;
			}
		}
		if (!best) {
			const remaining = pool.filter((p) => !selectedSet.has(p));
			if (remaining.length === 0) break;
			best = remaining.reduce((a, b) => ((degree.get(b) ?? 0) > (degree.get(a) ?? 0) ? b : a));
		}
		selected.push(best);
		selectedSet.add(best);
	}
	return housekeepingPick ? [...selected, housekeepingPick] : selected;
}

// -----------------------------------------------------------------------------------
// Hierarchy: pages sharing a source folder are one OneNote "section". Within a section
// of 2+ pages, the member other members link to the most becomes that section's
// top-level hub page; another member nests as its subpage only when a real link exists
// between that specific member and the hub - a shared folder alone is not evidence, a
// link is.
// -----------------------------------------------------------------------------------

const FALLBACK_SECTION = 'Notes';

function sectionOf(relPath) {
	const dir = path.posix.dirname(relPath);
	if (dir === '.') return FALLBACK_SECTION;
	return dir.split('/').join(' - ');
}

function assignHierarchy(pages, graph, degree) {
	const bySection = new Map();
	for (const p of pages) {
		const s = sectionOf(p);
		if (!bySection.has(s)) bySection.set(s, []);
		bySection.get(s).push(p);
	}
	const linked = (a, b) => (graph.get(a)?.has(b) ?? false) || (graph.get(b)?.has(a) ?? false);

	const parentOf = new Map();
	for (const group of bySection.values()) {
		if (group.length < 2) continue;
		let hub;
		let hubScore = [-1, -1];
		for (const cand of group) {
			const inboundFromGroup = group.filter((other) => other !== cand && (graph.get(other)?.has(cand) ?? false)).length;
			const score = [inboundFromGroup, degree.get(cand) ?? 0];
			if (score[0] > hubScore[0] || (score[0] === hubScore[0] && score[1] > hubScore[1])) {
				hub = cand;
				hubScore = score;
			}
		}
		if (hubScore[0] === 0) continue; // no member is referenced by a sibling: leave the group as peers
		for (const member of group) {
			if (member !== hub && linked(member, hub)) parentOf.set(member, hub);
		}
	}
	return { bySection, parentOf };
}

// -----------------------------------------------------------------------------------
// Same dependency-free PNG placeholder `packages/bench/src/corpus/render/onenote.ts`
// and `obsidian.ts` already use, reused here rather than invented afresh.
// -----------------------------------------------------------------------------------

let crcTable;
function crc32(buf) {
	if (!crcTable) {
		crcTable = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			crcTable[n] = c >>> 0;
		}
	}
	let crc = 0xffffffff;
	for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const typeBuf = Buffer.from(type, 'ascii');
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
	return Buffer.concat([len, typeBuf, data, crc]);
}

function seedNumber(seed) {
	let h = 2166136261;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

const PLACEHOLDER_PALETTES = [
	[58, 51, 43],
	[46, 54, 58],
	[52, 46, 40],
	[40, 48, 46]
];

function placeholderPortrait(seed, width = 220, height = 300) {
	const n = seedNumber(seed);
	const base = PLACEHOLDER_PALETTES[n % PLACEHOLDER_PALETTES.length];
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
	return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// -----------------------------------------------------------------------------------
// A dependency-free zip writer (STORE's cousin, DEFLATE via node:zlib), because the
// only zip reader this archive has to satisfy - `ArchiveSourceReader` in
// `packages/import/src/archive.ts`, built on `fflate`'s `unzipSync` - reads a plain
// standard zip and infers directories from file paths alone, so no directory entries
// are needed.
// -----------------------------------------------------------------------------------

function sanitizeFileName(name) {
	return name.replace(/[\\/:*?"<>|]/g, '-');
}

function dosDateTime(date) {
	const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f);
	const day =
		(((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
	return { time, day };
}

function buildZip(files) {
	const { time, day } = dosDateTime(new Date());
	const localParts = [];
	const centralParts = [];
	let offset = 0;
	for (const f of files) {
		const nameBuf = Buffer.from(f.path, 'utf8');
		const dataBuf = Buffer.isBuffer(f.bytes) ? f.bytes : Buffer.from(f.bytes);
		const compressed = deflateRawSync(dataBuf, { level: 9 });
		const crc = crc32(dataBuf);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6);
		local.writeUInt16LE(8, 8);
		local.writeUInt16LE(time, 10);
		local.writeUInt16LE(day, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(dataBuf.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		local.writeUInt16LE(0, 28);
		localParts.push(local, nameBuf, compressed);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x0800, 8);
		central.writeUInt16LE(8, 10);
		central.writeUInt16LE(time, 12);
		central.writeUInt16LE(day, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(compressed.length, 20);
		central.writeUInt32LE(dataBuf.length, 24);
		central.writeUInt16LE(nameBuf.length, 28);
		central.writeUInt16LE(0, 30);
		central.writeUInt16LE(0, 32);
		central.writeUInt16LE(0, 34);
		central.writeUInt16LE(0, 36);
		central.writeUInt32LE(0, 38);
		central.writeUInt32LE(offset, 42);
		centralParts.push(central, nameBuf);

		offset += local.length + nameBuf.length + compressed.length;
	}
	const centralStart = offset;
	const centralSize = centralParts.reduce((n, b) => n + b.length, 0);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(files.length, 8);
	eocd.writeUInt16LE(files.length, 10);
	eocd.writeUInt32LE(centralSize, 12);
	eocd.writeUInt32LE(centralStart, 16);
	return Buffer.concat([...localParts, ...centralParts, eocd]);
}

// -----------------------------------------------------------------------------------
// Markdown -> ugly OneNote HTML. One `<p class=MsoNormal>` per source line (real
// exported OneNote pages usually keep pasted line breaks rather than reflowing
// paragraphs), a resolved in-vault link becomes a real `<a href>`, anything else - a
// link outside this trimmed export, a dangling link, a link to this page's own
// structural partner (already carried by the "subpage of" relation, not repeated as
// prose per onenote.md's own reasoning) - collapses to its plain label.
// -----------------------------------------------------------------------------------

function escapeHtml(text) {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escapes first, then turns markdown emphasis into real tags on the escaped string -
 * safe because none of `**`, `*`, `` ` `` are HTML metacharacters. */
function formatRun(text) {
	let html = escapeHtml(text);
	html = html.replace(/\*\*([^*]+?)\*\*/g, '<b>$1</b>');
	html = html.replace(/\*([^*]+?)\*/g, '<i>$1</i>');
	html = html.replace(/`([^`]+?)`/g, '$1');
	return html;
}

function renderLine(line, ctx) {
	let html = '';
	let last = 0;
	for (const m of line.matchAll(MD_LINK)) {
		html += formatRun(line.slice(last, m.index));
		const label = m[1];
		const resolved = resolveMdHref(ctx.fromDir, m[2], ctx.notes, ctx.basenameIndex);
		const target = resolved && ctx.locations.has(resolved) ? resolved : undefined;
		const isStructuralPartner = target && ctx.structuralPartners.get(ctx.relPath)?.has(target);
		if (target && target !== ctx.relPath && !isStructuralPartner) {
			html += `<a href="${escapeHtml(ctx.hrefTo(target))}">${formatRun(label)}</a>`;
		} else {
			html += formatRun(label);
		}
		last = m.index + m[0].length;
	}
	html += formatRun(line.slice(last));
	return html;
}

function renderPageHtml(note, location, ctx, attachmentRelName) {
	const lines = note.raw.split('\n');
	const bodyLines = [];
	for (let line of lines) {
		if (/^#\s+/.test(line)) continue; // the H1 becomes <title>, not repeated in the canvas
		if (/^(---+|\*\*\*+)\s*$/.test(line)) continue; // markdown horizontal rules
		const heading = /^(#{2,6})\s+(.+)$/.exec(line);
		if (heading) {
			bodyLines.push(`<p class=MsoNormal><b><span style='font-family:"Calibri",sans-serif;font-size:11.0pt'>${formatRun(heading[2])}</span></b></p>`);
			continue;
		}
		if (line.trim() === '') continue;
		const html = renderLine(line, ctx);
		bodyLines.push(`<p class=MsoNormal><span style='font-family:"Calibri",sans-serif;font-size:11.0pt'>${html}</span></p>`);
	}
	const img = attachmentRelName
		? `\n<p class=MsoNormal><img src="${escapeHtml(attachmentRelName)}" width=220 height=300></p>`
		: '';
	return `<html xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta http-equiv=Content-Type content="text/html; charset=utf-8">
<title>${escapeHtml(note.title)}</title>
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
${bodyLines.join('\n')}${img}
</div>
</body>
</html>
`;
}

// -----------------------------------------------------------------------------------
// Archive assembly
// -----------------------------------------------------------------------------------

function dirOfLocation(loc) {
	return loc.parentFileBase ? `${loc.section}/${loc.parentFileBase}` : loc.section;
}

function hrefBetween(from, to) {
	const rel = path.posix.relative(dirOfLocation(from), dirOfLocation(to)) || '.';
	return path.posix.join(rel, `${to.fileBase}.htm`);
}

function buildOneNoteArchive({ notebookName, pages, notes: notesMap, hierarchy, graph, degree, basenameIndex }) {
	const locations = new Map();
	for (const p of pages) {
		const parent = hierarchy.parentOf.get(p);
		locations.set(p, {
			relPath: p,
			section: sectionOf(p),
			fileBase: sanitizeFileName(path.posix.basename(p, '.md')),
			parentFileBase: parent ? sanitizeFileName(path.posix.basename(parent, '.md')) : ''
		});
	}
	const structuralPartners = new Map();
	for (const [child, parent] of hierarchy.parentOf) {
		if (!structuralPartners.has(child)) structuralPartners.set(child, new Set());
		structuralPartners.get(child).add(parent);
		if (!structuralPartners.has(parent)) structuralPartners.set(parent, new Set());
		structuralPartners.get(parent).add(child);
	}

	const illustratedPage = pages.reduce((a, b) => ((degree.get(b) ?? 0) > (degree.get(a) ?? 0) ? b : a));

	const files = [];
	const documentPaths = [];
	for (const p of pages) {
		const loc = locations.get(p);
		const dir = `${notebookName}/${dirOfLocation(loc)}`;
		const note = notesMap.get(p);
		const ctx = {
			relPath: p,
			fromDir: path.posix.dirname(p),
			notes: notesMap,
			basenameIndex,
			locations,
			structuralPartners,
			hrefTo: (target) => hrefBetween(loc, locations.get(target))
		};
		let attachmentRelName;
		let attachmentPath;
		if (p === illustratedPage) {
			const imageFile = `${sanitizeFileName(note.title)}.png`;
			attachmentRelName = `${loc.fileBase}_files/${imageFile}`;
			attachmentPath = `${dir}/${loc.fileBase}_files/${imageFile}`;
		}
		const html = renderPageHtml(note, loc, ctx, attachmentRelName);
		const htmlPath = `${dir}/${loc.fileBase}.htm`;
		files.push({ path: htmlPath, bytes: Buffer.from(html, 'utf8') });
		documentPaths.push(htmlPath);
		if (attachmentPath) files.push({ path: attachmentPath, bytes: placeholderPortrait(p) });
	}
	files.sort((a, b) => a.path.localeCompare(b.path));
	documentPaths.sort();
	return { files, documentPaths, illustratedPage };
}

async function buildObsidianArchive(sourceDir, pages, notesMap) {
	const files = [];
	for (const p of pages) {
		files.push({ path: p, bytes: Buffer.from(notesMap.get(p).raw, 'utf8') });
	}
	files.push({ path: '.obsidian/app.json', bytes: Buffer.from('{}\n', 'utf8') });
	files.push({
		path: '.obsidian/community-plugins.json',
		bytes: Buffer.from('[]\n', 'utf8')
	});
	files.sort((a, b) => a.path.localeCompare(b.path));
	return files;
}

// -----------------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------------

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const sourceInfo = await stat(args.sourceDir).catch(() => undefined);
	if (!sourceInfo?.isDirectory()) throw new Error(`${args.sourceDir} is not a directory`);

	const relPaths = await walkMarkdownFiles(args.sourceDir);
	if (relPaths.length === 0) throw new Error(`no markdown notes found under ${args.sourceDir}`);
	const notes = await loadNotes(args.sourceDir, relPaths);
	const { graph, basenameIndex } = buildLinkGraph(notes);
	const { adj, degree } = undirectedFrom(graph);

	const pages = selectPages({ notes, adj, degree, limit: args.limit, seed: args.seed, explicitPages: args.pages });
	const hierarchy = assignHierarchy(pages, graph, degree);

	const notebookName = sanitizeFileName(`${path.basename(args.sourceDir)} Campaign`);
	const onenote = buildOneNoteArchive({ notebookName, pages, notes, hierarchy, graph, degree, basenameIndex });
	const obsidianFiles = await buildObsidianArchive(args.sourceDir, pages, notes);

	await mkdir(args.out, { recursive: true });
	const onenoteZip = buildZip(onenote.files);
	const obsidianZip = buildZip(obsidianFiles);
	const onenotePath = path.join(args.out, 'demo-corpus-onenote.zip');
	const obsidianPath = path.join(args.out, 'demo-corpus-obsidian.zip');
	await writeFile(onenotePath, onenoteZip);
	await writeFile(obsidianPath, obsidianZip);

	const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);
	console.log(`${pages.length} pages selected from ${relPaths.length} notes under ${args.sourceDir}`);
	console.log(`  onenote:  ${onenotePath} (${onenoteZip.length} bytes, sha256 ${sha(onenoteZip)})`);
	console.log(`  obsidian: ${obsidianPath} (${obsidianZip.length} bytes, sha256 ${sha(obsidianZip)})`);
	console.log('\nOneNote archive tree:');
	for (const f of onenote.files) console.log(`  ${f.path}`);
	console.log(`\nsubpage relations (${hierarchy.parentOf.size}):`);
	for (const [child, parent] of hierarchy.parentOf) console.log(`  ${child}  ->subpage of->  ${parent}`);
	console.log(`\nillustrated page: ${onenote.illustratedPage}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error(err.stack ?? String(err));
		process.exitCode = 1;
	});
}
