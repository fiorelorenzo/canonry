/**
 * A directory of markdown notes read as a `WikiClient`, so a real community world can be
 * indexed through the product's own `indexDataSource` pipeline (issue #278).
 *
 * Why this exists: issue #168's retrieval sweep measured 32 chunks, and its own conclusion
 * about top-k was explicitly conditional on that being too small to generalise from. The
 * blocker it named was that no universe of realistic size existed. Issue #257 landed
 * `scripts/build-demo-corpus.mjs`, which renders a real CC BY-SA vault into the import
 * formats, so the content is available; what was still missing was a way to get that
 * content into a universe's collection cheaply. Running it through the LLM import loop
 * costs about six credits a note (`docs/demo.md`: 19.37 credits for three notes), which is
 * five hundred credits for a vault this size and produces extracted proposals rather than
 * indexed prose. The indexed layer this sweep measures is not the import loop: it is
 * chunk, extract metadata, embed, upsert. So the vault goes in through
 * `indexDataSource`, the same call a MediaWiki crawl makes, with this client standing in
 * for the crawl.
 *
 * The conversion to wikitext is deliberately shallow. `chunkWikiPage` splits on
 * `== Heading ==` and nothing else, so a markdown note handed over untouched would be one
 * unbroken run of paragraphs and every chunk would carry the page title as its whole
 * breadcrumb. Mapping `## Heading` to `== Heading ==` is what makes the chunker see the
 * section structure the note actually has, which is what a real wiki page would have given
 * it. Everything else here strips markdown syntax that `wikitextToPlainText` does not know
 * about (fences, emphasis, list bullets, pipe tables) rather than rewriting prose.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { WikiClient, WikiPage } from '@canonry/indexing';

/** Directories that hold no world content: version control, the mkdocs theme overrides,
 * and Obsidian's own workspace state. Same set `scripts/build-demo-corpus.mjs` skips. */
const EXCLUDED_DIRS: Record<string, true> = {
	'.git': true,
	'.github': true,
	'.obsidian': true,
	node_modules: true,
	overrides: true
};

/** Repository meta rather than the world: a reader of the vault would not call these
 * pages. Everything else is kept, housekeeping notes included, because a real vault has
 * those and an importer would see them. */
const EXCLUDED_ROOT_FILES = /^(README|CONTRIBUTING|CHANGELOG|LICENSE)\.md$/i;

function walk(dir: string, base: string, out: string[]): void {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (EXCLUDED_DIRS[entry.name]) continue;
			walk(path.join(dir, entry.name), base, out);
			continue;
		}
		if (!entry.name.endsWith('.md')) continue;
		const relPath = path.relative(base, path.join(dir, entry.name));
		if (!relPath.includes(path.sep) && EXCLUDED_ROOT_FILES.test(entry.name)) continue;
		out.push(relPath);
	}
}

function stripFrontmatter(raw: string): string {
	if (!raw.startsWith('---')) return raw;
	const end = raw.indexOf('\n---', 3);
	if (end === -1) return raw;
	const after = raw.indexOf('\n', end + 1);
	return after === -1 ? '' : raw.slice(after + 1);
}

function titleOf(raw: string, relPath: string): string {
	for (const line of raw.split('\n')) {
		const match = /^#\s+(.+?)\s*$/.exec(line);
		if (match?.[1]) return match[1];
	}
	return path.basename(relPath, '.md');
}

/** Inline markdown that carries no meaning once the text is prose for an embedder:
 * images (nothing an embedding can use), link syntax around a label that is kept, and
 * emphasis. Bare `[[wikilinks]]` are left alone, since `wikitextToPlainText` unwraps
 * those itself. Applied to heading text as well as body text, so a heading that happens
 * to contain a link does not carry the target into every chunk's breadcrumb. */
function stripInline(text: string): string {
	return text
		.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
		.replace(/(?<!!)\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
		.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
		.replace(/`([^`]+)`/g, '$1');
}

/**
 * Markdown to the wikitext subset `chunkWikiPage` and `wikitextToPlainText` understand.
 * Line-oriented, because the only structure that matters downstream is the heading stack
 * and the paragraph breaks.
 *
 * The first `# Title` line is dropped: the page title is carried separately and
 * `splitIntoSections` already puts it at the root of every breadcrumb, so keeping it would
 * repeat it inside the first chunk's text.
 */
export function markdownToWikitext(raw: string, title: string): string {
	const lines = stripFrontmatter(raw).split('\n');
	const out: string[] = [];
	let inFence = false;
	let droppedTitle = false;

	for (const line of lines) {
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) {
			out.push(line);
			continue;
		}

		const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
		if (heading) {
			const text = stripInline(heading[2]!);
			if (!droppedTitle && heading[1]!.length === 1 && text === title) {
				droppedTitle = true;
				continue;
			}
			// Markdown level 1 becomes a wikitext level-2 section: level 1 in wikitext is the
			// page title itself, which is not a heading inside the body.
			const level = Math.max(2, Math.min(6, heading[1]!.length));
			const bars = '='.repeat(level);
			out.push(`${bars} ${text} ${bars}`);
			continue;
		}

		let text = line;
		// A markdown table row becomes its cells as prose; a separator row carries nothing.
		if (/^\s*\|/.test(text)) {
			if (/^\s*\|[\s|:-]*\|?\s*$/.test(text)) continue;
			text = text
				.replace(/^\s*\|/, '')
				.replace(/\|\s*$/, '')
				.split('|')
				.map((cell) => cell.trim())
				.filter((cell) => cell.length > 0)
				.join(' - ');
		}
		text = text.replace(/^\s*>\s?/, '');
		text = text.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '');
		text = text.replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/, '');
		out.push(stripInline(text));
	}

	return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export interface VaultPage {
	title: string;
	relPath: string;
	url: string;
	wikitext: string;
	updatedAt: Date;
}

/**
 * `updatedAt` is derived from the note's own content rather than its mtime. The pipeline
 * skips a page whose stored `pageUpdatedAt` equals the one it is handed, and a git clone
 * stamps every file with the moment it was checked out, so an mtime would make every
 * re-clone look like a world-wide edit and re-embed the whole corpus for nothing. A
 * content hash makes a re-run free and an actually-edited note re-index, which is what the
 * check is for.
 */
function pseudoUpdatedAt(content: string): Date {
	const digest = createHash('sha256').update(content).digest();
	const seconds = digest.readUInt32BE(0) % 1_000_000_000;
	return new Date(seconds * 1000);
}

export interface VaultClientOptions {
	/** Directory holding the markdown notes. */
	dir: string;
	/** Prefix for the page urls this client reports. One per corpus, so two vaults indexed
	 * into the same universe can never collide on a url. */
	urlBase: string;
	/** Cap on how many notes to serve, largest first, for a cheaper smoke run. */
	limit?: number;
}

/** A `WikiClient` over a markdown directory. Reads the whole vault once on construction:
 * it is a few megabytes of text, and both `listPageTitles` and `getPage` need it. */
export class VaultWikiClient implements WikiClient {
	private readonly pages: VaultPage[];
	private readonly byTitle: Map<string, VaultPage>;

	constructor(options: VaultClientOptions) {
		const relPaths: string[] = [];
		walk(options.dir, options.dir, relPaths);
		relPaths.sort();

		const pages: VaultPage[] = [];
		for (const relPath of relPaths) {
			const full = path.join(options.dir, relPath);
			if (!statSync(full).isFile()) continue;
			const raw = readFileSync(full, 'utf8');
			const title = titleOf(raw, relPath);
			const wikitext = markdownToWikitext(raw, title);
			if (wikitext.length === 0) continue;
			pages.push({
				title,
				relPath,
				url: `${options.urlBase}/${relPath.split(path.sep).map(encodeURIComponent).join('/')}`,
				wikitext,
				updatedAt: pseudoUpdatedAt(wikitext)
			});
		}

		// Duplicate titles would make `getPage` ambiguous, and a vault can legitimately have
		// two notes with the same `# Heading` in different folders. The path disambiguates.
		const byTitle = new Map<string, VaultPage>();
		for (const page of pages) {
			const key = byTitle.has(page.title) ? `${page.title} (${page.relPath})` : page.title;
			page.title = key;
			byTitle.set(key, page);
		}

		const ordered =
			options.limit === undefined
				? pages
				: [...pages].sort((a, b) => b.wikitext.length - a.wikitext.length).slice(0, options.limit);

		this.pages = ordered;
		this.byTitle = byTitle;
	}

	all(): VaultPage[] {
		return this.pages;
	}

	async listPageTitles(): Promise<string[]> {
		return this.pages.map((page) => page.title);
	}

	async getPage(title: string): Promise<WikiPage> {
		const page = this.byTitle.get(title);
		if (!page) throw new Error(`vault has no page titled "${title}"`);
		return {
			title: page.title,
			url: page.url,
			wikitext: page.wikitext,
			updatedAt: page.updatedAt
		};
	}
}
