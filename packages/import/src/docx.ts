/**
 * DOCX handling for issue #39 (SPEC.md §6.3, §6.6): "structure kept, visual styling
 * dropped" - `mammoth` turns a `.docx` into structured HTML (headings, paragraphs,
 * lists, tables), and this module turns that structure into the heading-prefixed plain
 * text `playbooks/docx.md` documents: `#`/`##`-prefixed headings, `- `-prefixed list
 * items, and table rows flattened to `|`-separated cells. Fonts, colours, page layout
 * and anything else purely visual never survive the trip, because none of it carries
 * meaning for canon.
 *
 * A pure function over DOCX bytes; wiring it into a real `SourceReader.read` for one
 * archive entry is issue #25's job (`ArchiveSourceReader`), not this file's.
 */
import mammoth from 'mammoth';

export class DocxParseError extends Error {
	constructor(cause: unknown) {
		super(`failed to parse DOCX: ${cause instanceof Error ? cause.message : String(cause)}`);
		this.name = 'DocxParseError';
	}
}

type HtmlNode = HtmlElementNode | HtmlTextNode;

interface HtmlElementNode {
	type: 'element';
	tag: string;
	children: HtmlNode[];
}

interface HtmlTextNode {
	type: 'text';
	value: string;
}

const VOID_TAGS: Record<string, true> = { br: true, img: true, hr: true };
const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' '
};

function decodeHtmlEntities(text: string): string {
	return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entity, body: string) => {
		if (body.startsWith('#x') || body.startsWith('#X')) {
			return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
		}
		if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
		return NAMED_ENTITIES[body] ?? entity;
	});
}

/**
 * A small, purpose-built parser for mammoth's own HTML output, not a general HTML
 * parser: mammoth's `convertToHtml` writes deterministic, machine-generated markup from
 * a fixed, known tag set (headings, `p`, lists, tables, a handful of inline tags and
 * its own empty bookmark anchors), so a regex-driven tag walk is safe here in a way it
 * would not be for arbitrary user HTML.
 */
function parseHtmlFragment(html: string): HtmlNode[] {
	const tagPattern = /<(\/)?([a-zA-Z][a-zA-Z0-9]*)(?:\s+[^<>]*?)?\s*(\/)?>/g;
	const root: HtmlElementNode = { type: 'element', tag: '#root', children: [] };
	const stack: HtmlElementNode[] = [root];
	let lastIndex = 0;
	for (const match of html.matchAll(tagPattern)) {
		const matchIndex = match.index;
		if (matchIndex > lastIndex) {
			const text = html.slice(lastIndex, matchIndex);
			if (text.length > 0) {
				const parent = stack[stack.length - 1];
				if (parent) parent.children.push({ type: 'text', value: decodeHtmlEntities(text) });
			}
		}
		lastIndex = matchIndex + match[0].length;
		const [, closing, tagName, selfClosing] = match;
		const tag = (tagName ?? '').toLowerCase();
		if (closing) {
			for (let i = stack.length - 1; i >= 1; i--) {
				if (stack[i]?.tag === tag) {
					stack.length = i;
					break;
				}
			}
		} else {
			const element: HtmlElementNode = { type: 'element', tag, children: [] };
			const parent = stack[stack.length - 1];
			if (parent) parent.children.push(element);
			if (!selfClosing && !VOID_TAGS[tag]) stack.push(element);
		}
	}
	if (lastIndex < html.length) {
		const text = html.slice(lastIndex);
		if (text.length > 0) root.children.push({ type: 'text', value: decodeHtmlEntities(text) });
	}
	return root.children;
}

function textOf(node: HtmlNode): string {
	if (node.type === 'text') return node.value;
	if (node.tag === 'br') return '\n';
	return node.children.map(textOf).join('');
}

function normalizeInlineText(node: HtmlNode): string {
	return textOf(node).trim().replace(/\s+/g, ' ');
}

const HEADING_LEVEL: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

function isElement(node: HtmlNode): node is HtmlElementNode {
	return node.type === 'element';
}

/** Every `<tr>` under a table, regardless of `<thead>`/`<tbody>` nesting, each row
 * flattened to its cell texts - `docx.md`'s "table rows flattened to `|`-separated
 * cells" makes no distinction between a header row and a body row. */
function tableRows(table: HtmlElementNode): string[][] {
	const rows: string[][] = [];
	function walk(node: HtmlNode): void {
		if (!isElement(node)) return;
		if (node.tag === 'tr') {
			rows.push(
				node.children
					.filter(isElement)
					.filter((cell) => cell.tag === 'td' || cell.tag === 'th')
					.map(normalizeInlineText)
			);
			return;
		}
		for (const child of node.children) walk(child);
	}
	walk(table);
	return rows;
}

/** Renders the top-level block sequence (headings, paragraphs, lists, tables) to the
 * plain-text blocks `docx.md` documents - one entry per heading/paragraph/list/table,
 * joined with a blank line by the caller. Recurses into wrapper elements with no text
 * meaning of their own (mammoth's empty `<a id="...">` bookmark anchors) so a block
 * nested one level deeper than expected is not silently dropped. */
function renderBlocks(nodes: readonly HtmlNode[]): string[] {
	const blocks: string[] = [];
	for (const node of nodes) {
		if (node.type === 'text') {
			const text = node.value.trim();
			if (text) blocks.push(text);
			continue;
		}
		const headingLevel = HEADING_LEVEL[node.tag];
		if (headingLevel !== undefined) {
			const text = normalizeInlineText(node);
			if (text) blocks.push(`${'#'.repeat(headingLevel)} ${text}`);
			continue;
		}
		if (node.tag === 'p') {
			const text = normalizeInlineText(node);
			if (text) blocks.push(text);
			continue;
		}
		if (node.tag === 'ul' || node.tag === 'ol') {
			const items = node.children
				.filter(isElement)
				.filter((item) => item.tag === 'li')
				.map((item) => normalizeInlineText(item))
				.filter((text) => text.length > 0)
				.map((text) => `- ${text}`);
			if (items.length > 0) blocks.push(items.join('\n'));
			continue;
		}
		if (node.tag === 'table') {
			const lines = tableRows(node)
				.filter((cells) => cells.length > 0)
				.map((cells) => `| ${cells.join(' | ')} |`);
			if (lines.length > 0) blocks.push(lines.join('\n'));
			continue;
		}
		if (node.children.length > 0) blocks.push(...renderBlocks(node.children));
	}
	return blocks;
}

export interface DocxTextExtraction {
	/** The `source_read` payload: heading-prefixed structured text. */
	text: string;
	/** Warnings mammoth raised while converting (e.g. an unrecognised paragraph style) -
	 * not fatal, since the paragraph itself still converts as plain text. */
	warnings: string[];
}

export async function extractDocxText(bytes: Uint8Array): Promise<DocxTextExtraction> {
	let result: Awaited<ReturnType<typeof mammoth.convertToHtml>>;
	try {
		result = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
	} catch (cause) {
		throw new DocxParseError(cause);
	}
	const blocks = renderBlocks(parseHtmlFragment(result.value));
	const text = blocks.length > 0 ? blocks.join('\n\n') + '\n' : '';
	return { text, warnings: result.messages.map((message) => message.message) };
}
