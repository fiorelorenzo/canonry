/**
 * Live decoration for the editor (#105, decision B2 = C: "type markdown, see it decorated
 * as you type"). This is deliberately not `markdown.ts`'s renderer: that one *consumes*
 * markdown syntax and replaces it with real elements, which is right for reading but wrong
 * for editing, since the editor's `<textarea>` still needs the raw source underneath. This
 * module never adds or removes a single character - every character of `source` reappears
 * in the output, just wrapped in styling spans - so the decorated view can sit as a
 * read-only backdrop directly behind a transparent `<textarea>` holding the same text: the
 * two stay pixel-aligned because they are, character for character, the same string.
 *
 * A light heuristic scanner, not a CommonMark parser: it recognises the handful of things
 * the toolbar can insert (bold, italic, heading, quote, list, link, mention) well enough to
 * decorate them while typing. `markdown.ts` remains the one authority on what the text
 * actually means once saved.
 */
import { resolveMentionName, type MentionTarget } from '../../markdown';

// Only `&` and `<` are structurally significant in HTML text content; a bare `>` renders
// identically escaped or not, and leaving it alone keeps this a true identity map onto the
// visible glyph stream, character for character, which the textarea overlay depends on.
function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

const INLINE_RE =
	/(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[\[[^\]\n]+\]\])|(!\[[^\]\n]*\]\([^)\n]*\))|(\[[^\]\n]+\]\([^)\n]*\))/g;

function decorateInline(text: string, targets: MentionTarget[]): string {
	let out = '';
	let last = 0;
	for (const match of text.matchAll(INLINE_RE)) {
		const [whole, bold, italic, mention, image, link] = match;
		const index = match.index ?? 0;
		out += escapeHtml(text.slice(last, index));
		if (bold) {
			out += `<span class="font-bold text-ink">${escapeHtml(bold)}</span>`;
		} else if (italic) {
			out += `<span class="italic text-ink">${escapeHtml(italic)}</span>`;
		} else if (mention) {
			const name = mention.slice(2, -2).trim();
			const resolved = resolveMentionName(name, targets);
			const cls = resolved
				? 'text-accent-ink border-b border-line-2'
				: 'text-danger border-b border-dashed border-line-2';
			out += `<span class="${cls}">${escapeHtml(mention)}</span>`;
		} else if (image) {
			// Same treatment as a link (below): image markdown is still just a link's
			// shape with a leading `!`, and the read view already renders it as an
			// `<img>` (markdown.ts's default image rule), so the editor only needs the
			// backdrop to stop looking like broken syntax while it's being typed.
			out += `<span class="text-accent-ink underline decoration-line-2">${escapeHtml(image)}</span>`;
		} else if (link) {
			out += `<span class="text-accent-ink underline decoration-line-2">${escapeHtml(link)}</span>`;
		}
		last = index + whole.length;
	}
	out += escapeHtml(text.slice(last));
	return out;
}

const HEADING_RE = /^(#{1,6})(\s+)(.*)$/;
const QUOTE_RE = /^(>\s?)(.*)$/;
const LIST_RE = /^([-*+]\s)(.*)$/;

function decorateLine(line: string, targets: MentionTarget[]): string {
	const heading = HEADING_RE.exec(line);
	if (heading) {
		const [, hashes, space, rest] = heading;
		return (
			`<span class="font-semibold text-muted">${escapeHtml(hashes)}</span>` +
			escapeHtml(space) +
			`<span class="font-semibold text-ink">${decorateInline(rest, targets)}</span>`
		);
	}
	const quote = QUOTE_RE.exec(line);
	if (quote) {
		const [, marker, rest] = quote;
		return `<span class="italic text-muted">${escapeHtml(marker)}${decorateInline(rest, targets)}</span>`;
	}
	const list = LIST_RE.exec(line);
	if (list) {
		const [, marker, rest] = list;
		return `<span class="text-muted">${escapeHtml(marker)}</span>${decorateInline(rest, targets)}`;
	}
	return decorateInline(line, targets);
}

/** Decorates every line of `source`. The output, with tags stripped, is `source` again -
 * verified in `decorate.test.ts` - which is what keeps it safe to lay behind the textarea. */
export function decorateMarkdown(source: string, targets: MentionTarget[]): string {
	return source
		.split('\n')
		.map((line) => decorateLine(line, targets))
		.join('\n');
}
