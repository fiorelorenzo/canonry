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
		return `<a href="${href}" class="mention">${label}</a>`;
	}
	// B2: unresolved stays visibly unresolved rather than a dead link, so nobody reads a
	// missing entity as if it were confirmed canon. A target excluded from `targets` -
	// gm_only on the public surface - resolves exactly the same way: no differential
	// signal that it exists (#159, guardrail 6).
	return `<span class="mention mention-unresolved" title="No entry named &ldquo;${label}&rdquo; yet">${label}</span>`;
};

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
 * Strips a `[[Name]]` mention down to its bare name, for display contexts that quote raw
 * body text as prose rather than rendering it as markdown - the Facts panel's excerpt,
 * say, which is meant to read like the sentence it evidences, brackets and all being
 * markdown syntax the GM never wrote to be read. The stored span itself is untouched;
 * this only shapes what a caller shows next to it.
 */
export function stripMentionSyntax(text: string): string {
	return text.replace(/\[\[([^\]\n]+)\]\]/g, '$1');
}
