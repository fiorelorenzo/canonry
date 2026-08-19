/**
 * Pure text-manipulation logic for the entry editor (#105, decisions B2 = C and G4 = A).
 *
 * Kept free of the DOM and of Svelte on purpose: a `<textarea>` in `MarkdownEditor.svelte`
 * owns typing, caret and undo/redo (a browser gets those right for free); everything this
 * module does is compute what the next string and the next selection should be, so it is
 * exercised directly in tests rather than through a mounted component and a fake DOM.
 */
import { type MentionTarget } from '../../markdown';

export interface TextEdit {
	source: string;
	selectionStart: number;
	selectionEnd: number;
}

/** Wraps `[start, end)` in `before`/`after`. An empty selection wraps nothing and leaves
 * the caret between the two markers, ready to type - `**|**` for a fresh bold word. */
export function wrapSelection(
	source: string,
	start: number,
	end: number,
	before: string,
	after: string = before
): TextEdit {
	const selected = source.slice(start, end);
	const next = source.slice(0, start) + before + selected + after + source.slice(end);
	return {
		source: next,
		selectionStart: start + before.length,
		selectionEnd: start + before.length + selected.length
	};
}

/** Prefixes every line touched by `[start, end)` with `prefix`, used for heading, quote and
 * list. Toggles off if every touched line already carries the prefix, so pressing the same
 * button twice undoes it rather than doubling it. */
export function toggleLinePrefix(
	source: string,
	start: number,
	end: number,
	prefix: string
): TextEdit {
	const lineStart = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
	let lineEnd = source.indexOf('\n', end);
	if (lineEnd === -1) lineEnd = source.length;

	const block = source.slice(lineStart, lineEnd);
	const lines = block.split('\n');
	const allPrefixed = lines.every((line) => line.startsWith(prefix));
	const nextLines = allPrefixed
		? lines.map((line) => line.slice(prefix.length))
		: lines.map((line) => prefix + line);
	const nextBlock = nextLines.join('\n');
	const delta = nextBlock.length - block.length;

	return {
		source: source.slice(0, lineStart) + nextBlock + source.slice(lineEnd),
		selectionStart: Math.max(lineStart, start + (allPrefixed ? -prefix.length : prefix.length)),
		selectionEnd: end + delta
	};
}

/** `[text](url)`, selection becomes the link text, caret lands inside the empty `()` so the
 * next keystroke types the URL. */
export function insertLink(source: string, start: number, end: number): TextEdit {
	const selected = source.slice(start, end) || 'link text';
	const before = source.slice(0, start);
	const after = source.slice(end);
	const next = `${before}[${selected}]()${after}`;
	const caret = start + selected.length + 3;
	return { source: next, selectionStart: caret, selectionEnd: caret };
}

/** `![alt](url)`; a selection becomes the alt text, the same reading `insertLink` gives a
 * selection, with a default alt when there is none. Unlike `insertLink`, `url` is already
 * known when this runs - the picker resolves an asset (or a freshly generated one) before
 * this is ever called - so the markdown is complete on insert and the caret lands just past
 * it, ready for the next sentence, rather than parked inside an argument still to be typed. */
export function insertImage(source: string, start: number, end: number, url: string): TextEdit {
	const alt = source.slice(start, end) || 'image';
	const before = source.slice(0, start);
	const after = source.slice(end);
	const markdown = `![${alt}](${url})`;
	const next = before + markdown + after;
	const caret = start + markdown.length;
	return { source: next, selectionStart: caret, selectionEnd: caret };
}

/** Inserts `[[` at the caret (or wraps a selection as `[[selection`) so the mention menu's
 * own trigger detection picks it up immediately, exactly like typing it by hand. */
export function insertMentionTrigger(source: string, start: number, end: number): TextEdit {
	const selected = source.slice(start, end);
	const next = source.slice(0, start) + '[[' + selected + source.slice(end);
	const caret = start + 2 + selected.length;
	return { source: next, selectionStart: caret, selectionEnd: caret };
}

/** An in-progress, unterminated mention: the trigger characters plus whatever has been
 * typed since, with the caret still inside it. */
export interface MentionTrigger {
	kind: '[[' | '@';
	/** Index of the trigger's first character. */
	start: number;
	query: string;
}

/** Scans backward from `caret` for a `[[` or `@` that has not yet been closed. `@` breaks
 * on whitespace (Slack/Notion/Linear muscle memory, per B2's own recommendation); `[[`
 * breaks only on a newline or on `]]`, since a mention name can contain a space. */
export function findActiveTrigger(source: string, caret: number): MentionTrigger | null {
	const upToCaret = source.slice(0, caret);

	const bracket = upToCaret.lastIndexOf('[[');
	if (bracket !== -1) {
		const between = upToCaret.slice(bracket + 2);
		if (!between.includes(']]') && !between.includes('\n')) {
			return { kind: '[[', start: bracket, query: between };
		}
	}

	const at = upToCaret.lastIndexOf('@');
	if (at !== -1) {
		const between = upToCaret.slice(at + 1);
		if (!/[\s[\]]/.test(between)) {
			return { kind: '@', start: at, query: between };
		}
	}

	return null;
}

/** Ranks candidates for a mention query: a name or alias that starts with the query first,
 * then anything that merely contains it, alphabetically within each group. */
export function matchTargets(targets: MentionTarget[], query: string, limit = 8): MentionTarget[] {
	const q = query.trim().toLowerCase();
	const nameOf = (target: MentionTarget) => target.name.toLowerCase();
	const candidates = q
		? targets.filter(
				(target) =>
					nameOf(target).includes(q) ||
					target.aliases.some((alias) => alias.toLowerCase().includes(q))
			)
		: targets;

	return candidates
		.slice()
		.sort((a, b) => {
			const aStarts = nameOf(a).startsWith(q) ? 0 : 1;
			const bStarts = nameOf(b).startsWith(q) ? 0 : 1;
			if (aStarts !== bStarts) return aStarts - bStarts;
			return a.name.localeCompare(b.name);
		})
		.slice(0, limit);
}

export type MentionMenuKey = 'ArrowDown' | 'ArrowUp' | 'Enter' | 'Tab' | 'Escape';

export type MentionMenuAction =
	| { type: 'move'; index: number }
	| { type: 'accept'; index: number }
	| { type: 'close' }
	| { type: 'ignore' };

/** Pure keyboard reducer for the mention menu: given the key pressed, which row is
 * currently highlighted, and how many rows the menu holds, decides what happens next.
 * Kept separate from the DOM so every key is tested directly rather than only reachable
 * through a mounted component - a menu only usable with the mouse fails B2's own point,
 * since `@` exists next to `[[` specifically for people who type. */
export function mentionMenuKeyAction(
	key: MentionMenuKey,
	highlightedIndex: number,
	matchCount: number
): MentionMenuAction {
	if (key === 'Escape') return { type: 'close' };
	if (matchCount === 0) return { type: 'ignore' };
	if (key === 'ArrowDown') return { type: 'move', index: (highlightedIndex + 1) % matchCount };
	if (key === 'ArrowUp')
		return { type: 'move', index: (highlightedIndex - 1 + matchCount) % matchCount };
	// Enter and Tab both accept. Tab is worth capturing too: it is the ordinary way to
	// leave a text field, and letting it escape the textarea instead of confirming the
	// highlighted match would be the same mouse-only failure Enter had.
	return { type: 'accept', index: highlightedIndex };
}

/** Replaces the trigger, from its start through `caretEnd`, with the canonical `[[Name]]`
 * form - the menu always inserts the resolved form directly, so there is nothing left to
 * normalise for a mention picked from the menu itself. */
export function applyMentionSelection(
	source: string,
	trigger: MentionTrigger,
	caretEnd: number,
	target: MentionTarget
): TextEdit {
	const replacement = `[[${target.name}]]`;
	const next = source.slice(0, trigger.start) + replacement + source.slice(caretEnd);
	const caret = trigger.start + replacement.length;
	return { source: next, selectionStart: caret, selectionEnd: caret };
}
