/**
 * #562's rule, made checkable: **a tinted surface takes `ink-2`, never `muted`.**
 *
 * `--color-muted` is a paper-and-panel ink. It clears AA against `--color-paper` and
 * `--color-panel` and fails it against every one of the five tinted backgrounds in at
 * least one palette, and against four of them in both: accent 4.30/3.97, diff 3.59/3.52,
 * ok 4.45/3.86, warn 4.54/4.06, danger 4.37/4.39 (light/dark). `--color-ink-2` clears all
 * ten with 6.70 at worst. Those ten measurements live in `layout.css` next to the tokens
 * they are about; this file is the thing that stops the pair coming back.
 *
 * #562 wrote the rule and fixed the two sites axe had caught, the audit panel's disclaimer
 * and the billing page's "/month". It did not sweep, and its own PR says why it did not
 * think it needed to: "37 files contain both a tint class and a muted class, but
 * co-occurrence is not adjacency". That is true and it is also what let seven more sites
 * survive, because the check it stood in for was axe on whatever page somebody happened to
 * screenshot. #711 was the eighth to be found that way, three rounds later, and finding
 * them one browser session at a time is the process this file replaces.
 *
 * The seven #711 swept up, and the reason six of them outlived an axe pass: only the
 * `AskAnswerRow` timestamp is tinted in a state a screenshot lands in. The others need a
 * pointer (`hover:` on the two source pills), a keyboard (`focus-within:` on an entries
 * table row), or a specific bit of state (the active nav item's count badge, the current
 * universe's row in a switcher that has to be opened first). axe measures what is on the
 * screen, so a rule that only holds in the default state is a rule that is not held.
 *
 * ## Adjacency, not co-occurrence
 *
 * So this reads the markup rather than the file. It walks each `.svelte` file's tags,
 * keeping a stack of what background each element actually sits on: an element that spells
 * a tinted background takes it, an element that spells an opaque one (`bg-panel`,
 * `bg-paper`, ...) clears it, and everything else inherits its parent's. A `text-muted` on
 * an element whose effective background is tinted is the defect.
 *
 * A tint counts whatever puts it there: a plain `bg-accent-bg`, a variant
 * (`hover:`, `focus-within:`, `aria-selected:`), or Svelte's `class:bg-accent-bg={cond}`
 * directive. A state is not an excuse, because a state is where six of the seven were.
 *
 * ## What this cannot see
 *
 * Worth being exact about, because a guard nobody knows the edges of gets trusted past
 * them.
 *
 * 1. **Composition across files.** The walk is per file. `<Badge class="text-muted" />`
 *    inside a tinted element is caught, because that class is written here; a component
 *    that spells `text-muted` inside *its own* file and gets rendered into a tinted parent
 *    somewhere else is not. Nothing in the tree does this today and nothing stops it.
 * 2. **Class lists that are not literals.** Only quoted strings are read. A list built
 *    from a variable, or assembled in `<script>` and interpolated, is invisible. `cn(...)`
 *    is fine, since its arguments are literals.
 * 3. **tailwind-merge (#653).** This reads source text, not resolved styles, and
 *    `twMerge` reads any unknown `text-*` as a colour. So in a merged list where a caller's
 *    class overrides a base one, the guard sees both literals and cannot say which
 *    survived: it will judge a `text-ink-2` that lost, or miss a `text-muted` that won.
 * 4. **Inheritance through a tint boundary.** A `text-muted` declared on an untinted
 *    ancestor is inherited by a tinted descendant that declares no colour of its own.
 *    The colour is real on the tint and no element carries both classes, so nothing here
 *    fires.
 * 5. **A background that is not a utility.** A tint from `layout.css`, `@apply`, or a
 *    `style=` attribute is not in the class list and does not exist as far as this is
 *    concerned.
 * 6. **Non-text.** An icon is a graphical object with a 3:1 floor rather than 4.5:1, and
 *    muted clears 3:1 against all five tints. `ALLOWED` carries the one site that is this,
 *    and it is an allowance rather than a blind spot only because it is written down.
 *
 * What it does see is every pair that is spelled in one file's markup, which is all eight
 * that exist, in every state rather than the one a screenshot caught.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));

/** This file spells every pattern it forbids, because it is the guard. */
const SELF = 'routes/tinted-surface-ink.test.ts';

/** The five that take a hue, exactly as `layout.css` names them. */
const TINTS = ['accent-bg', 'diff-bg', 'ok-bg', 'warn-bg', 'danger-bg'] as const;

/** Any variant prefix (`hover:`, `focus-within:`, `aria-selected:`, `md:`, `[&_svg]:`)
 * in front of the utility, because the rule is about the surface and not about how
 * transiently it is worn. */
const VARIANTS = String.raw`(?:[A-Za-z0-9_\-[\]&:.<>*'"=()]+:)*`;

const TINT_CLASS = new RegExp(String.raw`(?<![\w-])${VARIANTS}bg-(?:${TINTS.join('|')})(?![\w-])`);
/** Svelte's own conditional class, which is how four of the seven wore theirs. */
const TINT_DIRECTIVE = new RegExp(String.raw`class:bg-(?:${TINTS.join('|')})(?![\w-])`);

/** A background that puts the element back on an untinted surface. `--color-muted` is
 * right on paper and panel, so a descendant that re-declares one of these is out of
 * scope rather than a violation. `field` is here for the same reason as the rest and not
 * as an exception: #726 moved the form-field fill off the `bg-input/30` alpha composite
 * this file admits below that it cannot see, onto an opaque `--color-field` measured to
 * clear muted in both palettes (4.78 light, 5.23 dark). */
const OPAQUE_BG = new RegExp(
	String.raw`(?<![\w-])${VARIANTS}bg-(?:paper|panel-2|panel|field|background|card|popover|secondary|primary)(?![\w-])`
);

/** Both spellings: `--color-muted-foreground` is declared as `var(--color-muted)`, so
 * shadcn's alias resolves to the same value and fails the same way. */
const MUTED = new RegExp(String.raw`(?<![\w-])${VARIANTS}text-muted(?:-foreground)?(?![\w-])`);

/**
 * Deliberate exceptions, each with the reason it is not the defect. A stale entry is a
 * failure below, so this cannot quietly outlive what it excuses.
 */
const ALLOWED: { file: string; reason: string }[] = [
	{
		file: 'lib/components/ui/command/command-link-item.svelte',
		reason:
			"the muted lands on an <svg> through [&_svg:not([class*='text-'])], not on text. " +
			'A graphical object needs 3:1 rather than 4.5:1 (WCAG 1.4.11) and muted clears that ' +
			'against all five tints, the accent one it actually meets at 4.30 light and 3.97 dark. ' +
			"The item's own text is set by aria-selected:text-accent-ink on the same element."
	}
];

/** Every `.svelte` file under `apps/web/src`, relative to it. Markup only: the rule is
 * about what sits on what, and only a component nests. */
function sources(dir = '', out: string[] = []): string[] {
	for (const entry of readdirSync(`${SRC}${dir}`, { withFileTypes: true })) {
		const rel = `${dir}${entry.name}`;
		if (entry.isDirectory()) sources(`${rel}/`, out);
		else if (entry.name.endsWith('.svelte')) out.push(rel);
	}
	return out;
}

const ALL = sources();

/**
 * A file's markup, with `<script>`, `<style>` and comments blanked out rather than
 * removed, so a line number this file reports is the line number the file has.
 */
function markup(file: string): string {
	const source = readFileSync(`${SRC}${file}`, 'utf-8');
	const blank = (match: string) => match.replace(/[^\n]/g, ' ');
	return source
		.replace(/<script[\s\S]*?<\/script>/g, blank)
		.replace(/<style[\s\S]*?<\/style>/g, blank)
		.replace(/<!--[\s\S]*?-->/g, blank);
}

const TAG = /<(\/?)([A-Za-z][\w.:-]*)((?:[^<>'"]|"[^"]*"|'[^']*')*?)(\/?)>/g;

/** Nothing nests inside these, so they never become a parent on the stack. */
const VOID_ELEMENT: Record<string, true> = {
	area: true,
	base: true,
	br: true,
	col: true,
	embed: true,
	hr: true,
	img: true,
	input: true,
	link: true,
	meta: true,
	source: true,
	track: true,
	wbr: true
};

interface Pair {
	file: string;
	line: number;
	tint: string;
}

/**
 * Every element in one file that declares a muted ink while sitting on a tinted surface.
 *
 * The stack holds each open element's *effective* background: its own tint if it spells
 * one, nothing if it spells an opaque one, and otherwise whatever its parent sits on. A
 * close tag pops back to the matching open one by name, which is what keeps an unclosed
 * or mis-nested tag from skewing everything after it.
 */
function pairs(file: string): Pair[] {
	const source = markup(file);
	const stack: { tag: string; tint: string | null }[] = [];
	const found: Pair[] = [];

	for (const match of source.matchAll(TAG)) {
		const [, closing, tag, attrs, selfClosing] = match;
		if (closing) {
			for (let i = stack.length - 1; i >= 0; i--) {
				if (stack[i].tag === tag) {
					stack.length = i;
					break;
				}
			}
			continue;
		}

		const own = TINT_CLASS.exec(attrs) ?? TINT_DIRECTIVE.exec(attrs);
		const inherited = stack.length > 0 ? stack[stack.length - 1].tint : null;
		const tint = own ? own[0] : OPAQUE_BG.test(attrs) ? null : inherited;

		if (tint && MUTED.test(attrs)) {
			found.push({ file, line: source.slice(0, match.index).split('\n').length, tint });
		}
		if (!selfClosing && !VOID_ELEMENT[tag.toLowerCase()]) stack.push({ tag, tint });
	}
	return found;
}

const isAllowed = (file: string) => ALLOWED.some((entry) => entry.file === file);
const ALL_PAIRS = ALL.filter((file) => file !== SELF).flatMap(pairs);

describe('a tinted surface takes ink-2, never muted (#562, #711)', () => {
	it('finds the app it is walking', () => {
		// A broken walk would make every assertion below pass by finding nothing.
		expect(ALL.length).toBeGreaterThan(100);
		expect(ALL).toContain('lib/components/ask/AskAnswerRow.svelte');
	});

	it('finds the tinted surfaces it is meant to be checking', () => {
		const tinted = ALL.filter((file) => TINT_CLASS.test(markup(file)));
		// 40-odd files wear one today; the floor is a tripwire on the regex, not a census.
		expect(tinted.length).toBeGreaterThanOrEqual(20);
		expect(tinted).toContain('lib/components/ask/AskAnswerRow.svelte');
	});

	it('reads a muted ink that sits on a tint, in every state that can put it there', () => {
		// The shapes the seven of #711 were written in, so a regex that stops recognising
		// one of them fails here rather than passing silently for the rest of time.
		const shapes = [
			'<div class:bg-accent-bg={on}><p class="text-muted">x</p></div>',
			'<a class="bg-panel-2 hover:bg-warn-bg"><span class="text-muted">x</span></a>',
			'<tr class="focus-within:bg-ok-bg"><td class="text-muted-foreground">x</td></tr>'
		];
		for (const shape of shapes) {
			const stack: string[] = [];
			let hit = false;
			for (const match of shape.matchAll(TAG)) {
				const [, closing, , attrs] = match;
				if (closing) {
					stack.pop();
					continue;
				}
				const tinted =
					TINT_CLASS.test(attrs) || TINT_DIRECTIVE.test(attrs)
						? true
						: OPAQUE_BG.test(attrs)
							? false
							: stack.length > 0 && stack[stack.length - 1] === 'tinted';
				if (tinted && MUTED.test(attrs)) hit = true;
				stack.push(tinted ? 'tinted' : 'plain');
			}
			expect(hit, shape).toBe(true);
		}
	});

	it('leaves muted alone on paper and panel, which is where it belongs', () => {
		// The inverse tripwire: a regex that flagged everything would pass the test above.
		expect(pairs('lib/components/ask/AskAnswerRow.svelte')).toEqual([]);
		const untinted = '<div class="bg-panel"><p class="text-muted">x</p></div>';
		expect(TINT_CLASS.test(untinted)).toBe(false);
		expect(OPAQUE_BG.test(untinted)).toBe(true);
	});

	it('spells no muted ink on a tinted surface outside ALLOWED', () => {
		const offending = ALL_PAIRS.filter((pair) => !isAllowed(pair.file)).map(
			(pair) => `${pair.file}:${pair.line} (on ${pair.tint})`
		);
		expect(offending).toEqual([]);
	});

	it('keeps no allowance that has stopped being real', () => {
		const live = new Set(ALL_PAIRS.map((pair) => pair.file));
		expect(ALLOWED.filter((entry) => !live.has(entry.file)).map((entry) => entry.file)).toEqual([]);
	});
});
