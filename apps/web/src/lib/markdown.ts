/**
 * The one markdown renderer for canon prose (#105, decision B2 = C).
 *
 * Markdown is the stored form, full stop: `apps/web/src/lib/components/entry` never
 * hands this module anything but the raw text an entity's `body` column holds, and gets
 * back HTML meant only for display. `html: false` means raw HTML in that text is escaped
 * rather than trusted, because canon prose comes from imports and from the Loremaster as
 * well as from a GM's own typing, and none of those three sources gets to inject markup.
 *
 * The one extension beyond CommonMark is `[[Name]]`, a mention: SPEC 6.6 says an imported
 * Obsidian vault is full of this syntax already, so the renderer has to understand it
 * rather than only the editor. A mention resolves against the entities that already exist
 * in the same universe, by canonical name or by alias (`entity.aliases[]`, SPEC 4.2). An
 * unresolved mention renders visibly unresolved rather than as a dead `<a href="#">`,
 * because B2's own artifact makes that state part of the design, not an error case to
 * hide.
 */
import MarkdownIt from 'markdown-it';
import type { Env, Token } from 'markdown-it';
import { stripMentionSyntax, stripSecretsForPlayers } from '@canonry/lang';

/** Re-exported from `@canonry/lang` (#545): `packages/copilot`'s Ask needed the same
 * strip for its AI-off answer, which cannot import from `apps/web`, so the definition
 * moved there and this file keeps its own many existing `stripMentionSyntax` imports
 * working unchanged. See that module's own doc for the full reasoning. */
export { stripMentionSyntax };

/** The slice of an entity a mention needs to resolve and link to it. Deliberately not the
 * full entity row: this travels into `env` on every render call. */
export interface MentionTarget {
	name: string;
	slug: string;
	aliases: string[];
}

/** Which route tree a render call is for. `'gm'` is `/w/**`, session and universe
 * membership required; `'public'` is `/p/**`, open to anyone with the link. A mention's
 * href depends on this, because a link built for one surface is either a sign-in wall
 * (`'gm'` href shown to a signed-out player) or a route that does not exist on the other
 * (#159, guardrail 6: never a link off a public page into the GM surface). */
export type MentionSurface = 'gm' | 'public';

interface MentionEnv extends Env {
	universeSlug: string;
	targets: MentionTarget[];
	surface: MentionSurface;
}

/** Case-insensitive match against an entity's canonical name or any of its aliases.
 * Exported so the editor's mention menu (#105) and the save-time normaliser resolve
 * exactly the same way the renderer does; three independent implementations of "does
 * this name mean this entity" is how they'd quietly disagree. */
export function resolveMentionName(
	name: string,
	targets: MentionTarget[]
): MentionTarget | undefined {
	const key = name.trim().toLowerCase();
	if (!key) return undefined;
	for (const target of targets) {
		if (target.name.toLowerCase() === key) return target;
		if (target.aliases.some((alias) => alias.toLowerCase() === key)) return target;
	}
	return undefined;
}

// One markdown-it instance for the process. Rules are registered once at module load;
// per-render state (which universe, which entities resolve) travels through markdown-it's
// own `env` parameter instead of paying for a fresh instance, and a fresh rule
// registration, on every entry page render.
const md = new MarkdownIt({
	html: false,
	linkify: false,
	typographer: false
});

md.inline.ruler.before('link', 'mention', (state, silent) => {
	const src = state.src;
	const start = state.pos;
	if (src.charCodeAt(start) !== 0x5b || src.charCodeAt(start + 1) !== 0x5b) return false;
	const end = src.indexOf(']]', start + 2);
	if (end === -1) return false;
	const name = src.slice(start + 2, end).trim();
	if (!name) return false;
	if (!silent) {
		const env = state.env as MentionEnv;
		const token = state.push('mention', '', 0);
		token.content = name;
		token.meta = { target: resolveMentionName(name, env.targets) };
	}
	state.pos = end + 2;
	return true;
});

interface MentionTokenMeta {
	target?: MentionTarget;
}

md.renderer.rules.mention = (tokens: Token[], idx: number, _options, env) => {
	const token = tokens[idx];
	// markdown-it types `Token.meta` as `any`; this reads back exactly the shape the rule
	// above just wrote onto this token, in the same render pass.
	const meta = token.meta as MentionTokenMeta;
	const target = meta.target;
	const mentionEnv = env as MentionEnv;
	const label = md.utils.escapeHtml(token.content);
	if (target) {
		const universeSlug = md.utils.escapeHtml(mentionEnv.universeSlug);
		const slug = md.utils.escapeHtml(target.slug);
		// `targets` on the public surface is always `publicMentionTargets`'s result
		// (`$lib/server/players.ts`'s `loadPublicEntity`, `@canonry/db`'s own doc comment
		// on that query) - the one place "is this entity public" is decided, gm_only
		// excluded there and nowhere re-checked here. A target present in `targets` at
		// all is therefore public by construction; this rule never re-derives that.
		const href =
			mentionEnv.surface === 'public'
				? `/p/${universeSlug}/${slug}`
				: `/w/${universeSlug}/e/${slug}`;
		// `data-entry-slug` (#429, T2 round fifteen): the one marker `MentionPreview.svelte`
		// keys its trigger anchors off, so a link that names an entity previews wherever it
		// sits - inside rendered prose here, and on the sidebar's Recents links, which build
		// the same attribute by hand since they never pass through this renderer at all. The
		// class stays too, styling only: `EntryProse.svelte`'s `a.mention` rule reads it,
		// this attribute is the only thing any script reads.
		return `<a href="${href}" class="mention" data-entry-slug="${slug}">${label}</a>`;
	}
	// B2: unresolved stays visibly unresolved rather than a dead link, so nobody reads a
	// missing entity as if it were confirmed canon. A target excluded from `targets` -
	// gm_only on the public surface - resolves exactly the same way: no differential
	// signal that it exists (#159, guardrail 6).
	return `<span class="mention mention-unresolved" title="No entry named &ldquo;${label}&rdquo; yet">${label}</span>`;
};

/**
 * R9, round thirteen (#384): an inserted image can carry a width, `![alt](/path =50%)` -
 * markdown-it's own image-resize convention, restricted to a bare percentage.
 * `matchImageToken` is the one definition of that grammar: the inline rule just below uses
 * it to decide whether an `<img>` gets a `style="width:…"`, and `editorState.ts`'s
 * `findImageTokens` (the editor preview's "hover an image, change its width" affordance)
 * uses the same function to find and rewrite a token at its exact position in the raw
 * body - one grammar, so rendering and editing can never disagree about what counts as a
 * sized image.
 *
 * Deliberately simpler than CommonMark's own image grammar: no title, no reference form, no
 * escaped brackets in the alt text - nothing this app ever writes uses any of those, and
 * `decorate.ts`'s own live-typing heuristic already draws the same boundary. Anything this
 * function does not recognise, including a malformed size suffix, returns `null`; the
 * inline rule then defers entirely to markdown-it's own `image` rule, so an ordinary image
 * and a botched suffix alike render exactly as they did before this existed - a malformed
 * suffix is inert rather than a broken link.
 */
export interface ParsedImageToken {
	/** Index just past the closing `)`, in whatever string `text` was. */
	end: number;
	alt: string;
	url: string;
	/** 1-100 when a well-formed `=NN%` suffix was present, already clamped into range;
	 * `null` when there was no suffix at all. Never the *unclamped* number - nothing
	 * downstream should have to re-derive the bound this module already enforces, because
	 * a percentage written into canon prose is never trusted to be in range on its own. */
	widthPercent: number | null;
}

export const IMAGE_WIDTH_MIN = 1;
export const IMAGE_WIDTH_MAX = 100;

/** The three widths `ImageInsertDialog.svelte` and the editor's preview offer - a measure,
 * never a pixel value: "the measure is responsive and a pixel value is a promise the
 * layout cannot keep." A third and two thirds round to the nearest percentage point. */
export const IMAGE_WIDTH_PERCENTS = [33, 67, 100] as const;
export type ImageWidthPercent = (typeof IMAGE_WIDTH_PERCENTS)[number];

export function clampImageWidthPercent(percent: number): number {
	return Math.min(IMAGE_WIDTH_MAX, Math.max(IMAGE_WIDTH_MIN, Math.round(percent)));
}

export function matchImageToken(
	text: string,
	start: number,
	maxEnd: number = text.length
): ParsedImageToken | null {
	if (text.charCodeAt(start) !== 0x21 /* ! */ || text.charCodeAt(start + 1) !== 0x5b /* [ */) {
		return null;
	}
	const altEnd = text.indexOf(']', start + 2);
	if (altEnd < 0 || altEnd >= maxEnd || text.charCodeAt(altEnd + 1) !== 0x28 /* ( */) return null;
	const alt = text.slice(start + 2, altEnd);

	let pos = altEnd + 2;
	const urlStart = pos;
	while (pos < maxEnd) {
		const code = text.charCodeAt(pos);
		if (code === 0x20 || code === 0x09 || code === 0x28 || code === 0x29 || code === 0x0a) break;
		pos++;
	}
	if (pos === urlStart) return null; // `![alt]()` - no destination
	const url = text.slice(urlStart, pos);

	const wsStart = pos;
	while (pos < maxEnd && (text.charCodeAt(pos) === 0x20 || text.charCodeAt(pos) === 0x09)) pos++;

	let widthPercent: number | null = null;
	if (pos > wsStart) {
		// Whitespace before the close paren means either a size suffix or nothing this
		// syntax recognises - anything other than `=NN%` here is malformed, not sized.
		if (text.charCodeAt(pos) !== 0x3d /* = */) return null;
		const digitsStart = pos + 1;
		let digitsEnd = digitsStart;
		while (
			digitsEnd < maxEnd &&
			text.charCodeAt(digitsEnd) >= 0x30 &&
			text.charCodeAt(digitsEnd) <= 0x39
		) {
			digitsEnd++;
		}
		if (digitsEnd === digitsStart || text.charCodeAt(digitsEnd) !== 0x25 /* % */) return null;
		widthPercent = clampImageWidthPercent(Number(text.slice(digitsStart, digitsEnd)));
		pos = digitsEnd + 1;
	}

	if (pos >= maxEnd || text.charCodeAt(pos) !== 0x29 /* ) */) return null;
	return { end: pos + 1, alt, url, widthPercent };
}

/** Every image URL referenced anywhere in `source`'s markdown, in document order -
 * issue #385: what a delete confirms against before removing a `media_asset` row, so
 * a body pointing at a missing image (a broken reference nobody can fix without also
 * knowing to re-type the alt text) never happens. Shares `matchImageToken` with
 * `editorState.ts`'s own `findImageTokens`, the editor preview's hover-to-resize scan
 * - same grammar, so a delete and a render can never disagree about what the body
 * still points at. */
export function imageUrlsIn(source: string): string[] {
	const urls: string[] = [];
	for (let i = 0; i < source.length; i++) {
		if (source.charCodeAt(i) !== 0x21 /* ! */) continue;
		const matched = matchImageToken(source, i);
		if (matched) urls.push(matched.url);
	}
	return urls;
}

md.inline.ruler.before('image', 'sized-image', (state, silent) => {
	const matched = matchImageToken(state.src, state.pos, state.posMax);
	// No suffix at all: defer to the core `image` rule so an ordinary `![alt](url)`
	// renders exactly as it always has - this rule exists only for the sized case.
	if (!matched || matched.widthPercent === null) return false;
	const href = state.md.normalizeLink(matched.url);
	if (!state.md.validateLink(href)) return false;

	if (!silent) {
		const tokens: Token[] = [];
		state.md.inline.parse(matched.alt, state.md, state.env, tokens);
		const token = state.push('image', 'img', 0);
		token.attrs = [
			['src', href],
			['alt', ''],
			['style', `width:${matched.widthPercent}%`]
		];
		token.children = tokens;
		token.content = matched.alt;
	}
	state.pos = matched.end;
	return true;
});

/** Full block render: paragraphs, headings, lists, the lot. Used for the entry read view. */
export function renderMarkdown(
	source: string,
	universeSlug: string,
	targets: MentionTarget[],
	surface: MentionSurface
): string {
	return md.render(source, { universeSlug, targets, surface } satisfies MentionEnv);
}

/** Inline-only render, no block wrapper. Used for the highlight splice below and anywhere
 * a caller already owns the surrounding block element. */
export function renderMarkdownInline(
	source: string,
	universeSlug: string,
	targets: MentionTarget[],
	surface: MentionSurface
): string {
	return md.renderInline(source, { universeSlug, targets, surface } satisfies MentionEnv);
}

/** A fact's span into the body that produced it (`packages/db`'s `factWithSource`, #17). */
export interface FactSpan {
	start: number;
	end: number;
}

function computeLineStarts(source: string): number[] {
	const starts = [0];
	for (let i = 0; i < source.length; i++) {
		if (source[i] === '\n') starts.push(i + 1);
	}
	return starts;
}

/**
 * Renders `source` exactly like `renderMarkdown`, except the paragraph containing
 * `span` gets that exact character range wrapped in `<mark class="factspan">`, so the
 * Facts panel (B4 = B, "highlights the exact span of the body it came from") can point
 * at the sentence a fact was extracted from without the GM going and finding it by eye.
 *
 * Scoped to plain paragraphs on purpose: a heading or blockquote strips its own marker
 * before the inline token sees it, so the raw-source offset math below would silently be
 * wrong for those block types. A fact is, by construction, extracted from prose, never
 * from a heading, so this is a real constraint rather than a shortcut - if no paragraph
 * contains the span cleanly, the render falls back to plain markdown rather than guessing.
 */
export function renderMarkdownWithHighlight(
	source: string,
	universeSlug: string,
	targets: MentionTarget[],
	span: FactSpan,
	surface: MentionSurface
): string {
	const env: MentionEnv = { universeSlug, targets, surface };
	const tokens = md.parse(source, env);
	const lineStarts = computeLineStarts(source);

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token.type !== 'paragraph_open' || !token.map) continue;
		const blockStart = lineStarts[token.map[0]];
		const blockEnd = lineStarts[token.map[1]] ?? source.length;
		if (span.start < blockStart || span.end > blockEnd) continue;

		const inline = tokens[i + 1];
		if (inline?.type !== 'inline') continue;
		const relStart = span.start - blockStart;
		const relEnd = span.end - blockStart;
		if (relStart < 0 || relEnd > inline.content.length || relStart >= relEnd) continue;

		const before = inline.content.slice(0, relStart);
		const mid = inline.content.slice(relStart, relEnd);
		const after = inline.content.slice(relEnd);

		const openTag = md.renderer.renderToken(tokens, i, md.options);
		const closeTag = md.renderer.renderToken(tokens, i + 2, md.options);
		const highlightedBlock =
			openTag +
			renderMarkdownInline(before, universeSlug, targets, surface) +
			`<mark class="factspan">${renderMarkdownInline(mid, universeSlug, targets, surface)}</mark>` +
			renderMarkdownInline(after, universeSlug, targets, surface) +
			closeTag;

		const beforeHtml = md.renderer.render(tokens.slice(0, i), md.options, env);
		const afterHtml = md.renderer.render(tokens.slice(i + 3), md.options, env);
		return beforeHtml + highlightedBlock + afterHtml;
	}

	return renderMarkdown(source, universeSlug, targets, surface);
}

/**
 * Save-time normalisation (#105 acceptance): every `[[Name]]` that resolves, by canonical
 * name or by alias, is rewritten to `[[Canonical Name]]`. Run once here rather than trusted
 * from the client, since the editor's own resolution is a UX convenience, not the source of
 * truth for what got typed. An unresolved mention is left exactly as typed - normalising a
 * name nobody can match would silently invent a fact about what it refers to.
 */
export function normalizeMentions(body: string, targets: MentionTarget[]): string {
	return body.replace(/\[\[([^\]\n]+)\]\]/g, (whole, rawName: string) => {
		const target = resolveMentionName(rawName, targets);
		return target ? `[[${target.name}]]` : whole;
	});
}

/**
 * The opening of a body as plain prose, for the mention preview card (#364).
 *
 * `stripSecretsForPlayers` runs first, on both surfaces, always. `@canonry/lang` holds the
 * one definition of what a fence hides, and a preview that sliced a body itself would be a
 * second one living inside a floating box nobody thinks to audit, which is #355 all over
 * again. The GM's own card strips too, even though the GM may read the whole entry on the
 * page below: a glance card is exactly the surface that gets read over a shoulder at a
 * table, and one code path for both surfaces means the players' side cannot be the one that
 * quietly regresses.
 *
 * Then markdown becomes prose, because the card renders this as text and never as HTML: a
 * heading marker, an emphasis pair or an image reference would otherwise show up as
 * punctuation in the middle of a sentence. Truncation lands on a word boundary when there
 * is one close enough to the limit, and adds an ellipsis so a cut sentence reads as cut.
 */
export function mentionPreviewExcerpt(body: string, limit = 200): string {
	const plain = stripMentionSyntax(stripSecretsForPlayers(body))
		// Thematic breaks first: `---` is not a list bullet and must not become one.
		.replace(/^[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, ' ')
		// An image's alt text is a description of a picture, not the entry's prose.
		.replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, ' ')
		.replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
		.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
		.replace(/^[ \t]{0,3}>[ \t]?/gm, '')
		.replace(/^[ \t]{0,3}(?:[-*+]|\d+[.)])[ \t]+/gm, '')
		.replace(/\*\*|__|~~|`+|[*_]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (plain.length <= limit) return plain;
	const cut = plain.slice(0, limit);
	const lastSpace = cut.lastIndexOf(' ');
	const kept = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut;
	return `${kept.trimEnd()}\u2026`;
}
