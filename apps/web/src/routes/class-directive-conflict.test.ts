/**
 * #717's rule, made checkable: **a `class:` directive may not compete with a bare
 * utility of the same property in the same element's class attribute.**
 *
 * A Svelte `class:foo={cond}` directive puts `foo` on the element as a plain class,
 * beside whatever the `class` attribute already spelled. Two bare utilities setting the
 * same CSS property have equal specificity, so neither the order they are written in nor
 * the fact that one is conditional decides anything: the winner is the order Tailwind
 * emitted the two rules in, which is alphabetical-ish and nothing an author controls.
 *
 * `Sidebar.svelte`'s count badge was that. It spelled `bg-panel-2` in the attribute and
 * added `class:bg-accent-bg={active}`, and Tailwind emits `.bg-panel-2` fifteen rules
 * after `.bg-accent-bg`, so panel-2 won in every state and the active badge had never
 * been tinted since the day it was written. Nothing failed, nothing warned, and the
 * class list in the DOM carried both, with the intended one last and losing.
 *
 * ## Why a directive and not a merged list
 *
 * Every other way two backgrounds meet in this app goes through `cn`, and
 * tailwind-merge deletes the loser instead of leaving the browser to pick: `cn('bg-panel-2',
 * 'bg-accent-bg')` returns `'bg-accent-bg'` alone. A `class:` directive is the one channel
 * that cannot be merged, because it is applied by the compiler after the attribute is
 * built. So the rule is not "avoid directives", it is "a directive must not name a
 * property the attribute already names". A directive on an element with no competing
 * utility is fine, and eleven of them are exactly that.
 *
 * A **variant** is also fine, and this is the distinction #717 turned on: `hover:bg-panel-2`
 * beside `class:bg-accent-bg` is not a tie, because `hover:` adds a pseudo-class and
 * therefore specificity, so the hover rule wins whenever it applies and the directive wins
 * the rest of the time. That is a decidable outcome rather than a coin flip on emission
 * order, so the check below only looks at bare utilities.
 *
 * ## Two halves, because one of them is #653's blind spot
 *
 * The first half reads source text and finds the tying pattern anywhere in the tree, in
 * every state, which is the part a screenshot cannot do: the badge needed a specific route
 * to be open before it was even on screen, which is how it survived three rounds of axe
 * passes. The second half asserts that `cn` really resolves the pair, for every colour
 * token, because that is what the fix now depends on and #653 is the standing proof that
 * this library's behaviour on this repo's tokens is not something to assume: it read an
 * unknown `text-*` as a colour and silently deleted the whole type scale. A source guard
 * cannot see a resolution, so it gets asserted directly instead of hoped for.
 *
 * ## What this cannot see
 *
 * 1. **Which class won.** This reads source text, not resolved styles. It can say two
 *    bare utilities are competing; it cannot say what the browser painted. The computed
 *    background in #717's PR body is the only thing that says the tint now appears, and
 *    a rendered check is the only thing that could say it again.
 * 2. **Whether two directives are really exclusive.** Six elements carry two `class:bg-*`
 *    directives with conditions that are negations of each other (`class:bg-accent-bg={x}`
 *    beside `class:bg-panel={!x}`), which is safe and is the other shape #717 considered.
 *    Nothing here evaluates a condition, so two directives whose conditions merely look
 *    exclusive and are not would tie and this would not fire.
 * 3. **Class lists that are not literals.** Only quoted strings are read, so a list built
 *    in `<script>` and interpolated is invisible. Arguments to `cn(...)` are literals and
 *    are read.
 * 4. **Properties beyond these three.** `bg-*`, `text-*` and `border-*` restricted to the
 *    `--color-*` token names, which is what keeps `text-label` (a font size) and
 *    `border-2` (a width) out of it. A tie on `ring-*`, `shadow-*`, `fill-*` or a spacing
 *    utility is the same mechanism and is not checked, because none exists today.
 * 5. **A utility that is not in the class attribute at all**, from `@apply`, `layout.css`
 *    or a `style=` attribute.
 * 6. **A tag whose attributes contain a bare `<` or `>`.** The tag regex, shared in shape
 *    with `tinted-surface-ink.test.ts`, stops at one, so `class={a > b ? 'x' : 'y'}` would
 *    hide the element rather than misjudge it. Nothing in the tree writes that today.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cn } from '$lib/utils/cn';

const SRC = fileURLToPath(new URL('..', import.meta.url));

/**
 * Every colour token `layout.css` declares, longest first so `bg-panel-2` is preferred
 * over `bg-panel` when both could match. Read from the stylesheet rather than listed here,
 * for the reason `type-scale.test.ts` gives: a list spelled in two places drifts.
 */
const COLOUR_TOKENS = [
	...new Set(
		[...readFileSync(`${SRC}routes/layout.css`, 'utf-8').matchAll(/--color-([a-z0-9-]+)\s*:/g)].map(
			(match) => match[1]
		)
	)
].sort((a, b) => b.length - a.length);

const GROUP = COLOUR_TOKENS.join('|');

/** The three prefixes a colour token can carry, each setting one property. */
const PROPERTIES = ['bg', 'text', 'border'] as const;

/**
 * Bare: no variant prefix, which in a class list means no `:` immediately before the
 * utility. `hover:bg-panel-2` and `[&_svg]:bg-panel-2` are both excluded by the lookbehind,
 * and both are excluded on purpose (see the doc comment).
 */
const bare = (property: string) =>
	new RegExp(String.raw`(?<![\w-:])${property}-(?:${GROUP})(?![\w-])`, 'g');

const directive = (property: string) =>
	new RegExp(String.raw`class:${property}-(?:${GROUP})(?![\w-])`, 'g');

/** Every `.svelte` file under `apps/web/src`, relative to it. A `class:` directive is
 * Svelte-only syntax, so nothing else can carry one. */
function sources(dir = '', out: string[] = []): string[] {
	for (const entry of readdirSync(`${SRC}${dir}`, { withFileTypes: true })) {
		const rel = `${dir}${entry.name}`;
		if (entry.isDirectory()) sources(`${rel}/`, out);
		else if (entry.name.endsWith('.svelte')) out.push(rel);
	}
	return out;
}

const ALL = sources();

/** `<script>`, `<style>` and comments blanked rather than removed, so a line number this
 * file reports is the line number the file has. */
function markup(file: string): string {
	const blank = (match: string) => match.replace(/[^\n]/g, ' ');
	return readFileSync(`${SRC}${file}`, 'utf-8')
		.replace(/<script[\s\S]*?<\/script>/g, blank)
		.replace(/<style[\s\S]*?<\/style>/g, blank)
		.replace(/<!--[\s\S]*?-->/g, blank);
}

const TAG = /<(\/?)([A-Za-z][\w.:-]*)((?:[^<>'"]|"[^"]*"|'[^']*')*?)(\/?)>/g;

/**
 * Every class string one element's own `class` spells: the quoted attribute, plus every
 * quoted string inside a `class={...}` expression, since `cn(...)` and a ternary both put
 * their literals there.
 *
 * The branches of a ternary are unioned rather than kept apart, which is the conservative
 * reading: a directive competes with whichever branch is live, so any bare utility in any
 * branch is a real tie.
 */
function classText(attrs: string): string {
	const strings: string[] = [];
	for (const match of attrs.matchAll(/(?<![\w-:])class\s*=\s*("([^"]*)"|'([^']*)')/g)) {
		strings.push(match[2] ?? match[3]);
	}
	for (const match of attrs.matchAll(/(?<![\w-:])class\s*=\s*\{([\s\S]*?)\}\s*(?=[\s/>])/g)) {
		for (const literal of match[1].matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)) {
			strings.push(literal[1] ?? literal[2] ?? literal[3] ?? '');
		}
	}
	return strings.join(' ');
}

interface Tie {
	file: string;
	line: number;
	property: string;
	attribute: string[];
	directive: string[];
}

/** Every element whose `class:` directive names a property its own class attribute already
 * names with a bare utility, under a different token. */
function ties(file: string): Tie[] {
	const source = markup(file);
	const found: Tie[] = [];

	for (const match of source.matchAll(TAG)) {
		const [, closing, , attrs] = match;
		if (closing) continue;

		const text = classText(attrs);
		for (const property of PROPERTIES) {
			const attribute = [...new Set([...text.matchAll(bare(property))].map((hit) => hit[0]))];
			if (attribute.length === 0) continue;
			const directives = [
				...new Set(
					[...attrs.matchAll(directive(property))].map((hit) => hit[0].slice('class:'.length))
				)
			].filter((utility) => !attribute.includes(utility));
			if (directives.length === 0) continue;
			found.push({
				file,
				line: source.slice(0, match.index).split('\n').length,
				property,
				attribute,
				directive: directives
			});
		}
	}
	return found;
}

const ALL_TIES = ALL.flatMap(ties);

/** The three spellings of one element the detector has to recognise, all of them the
 * `Sidebar` badge as it was before #717. */
const TYING_SHAPES = [
	'<span class="rounded-full bg-panel-2 text-label" class:bg-accent-bg={active}>1</span>',
	"<span class={cn('rounded-full bg-panel-2')} class:bg-accent-bg={active}>1</span>",
	"<span class={active ? 'bg-panel-2' : 'bg-panel'} class:bg-accent-bg={active}>1</span>"
];

/** Shapes that look like the defect and are not, each for a different reason. */
const SAFE_SHAPES = [
	// A variant carries a pseudo-class, so specificity decides rather than emission order.
	'<a class="rounded-md hover:bg-panel-2" class:bg-accent-bg={active}>x</a>',
	// Same token both sides: both resolve to the same declaration, so nothing can differ.
	'<a class="bg-panel-2" class:bg-panel-2={active}>x</a>',
	// Two directives and no competing attribute utility, which is the exclusive shape.
	'<div class="rounded-lg border p-4" class:bg-accent-bg={on} class:bg-panel={!on}>x</div>',
	// A colour-less attribute beside a directive: `text-label` is a font size, not a colour.
	'<span class="text-label" class:text-ink={active}>x</span>',
	// A width, not a colour.
	'<span class="border-2" class:border-accent={active}>x</span>'
];

function tiesIn(fragment: string): number {
	let count = 0;
	for (const match of fragment.matchAll(TAG)) {
		const [, closing, , attrs] = match;
		if (closing) continue;
		const text = classText(attrs);
		for (const property of PROPERTIES) {
			const attribute = [...new Set([...text.matchAll(bare(property))].map((hit) => hit[0]))];
			if (attribute.length === 0) continue;
			const directives = [
				...new Set(
					[...attrs.matchAll(directive(property))].map((hit) => hit[0].slice('class:'.length))
				)
			].filter((utility) => !attribute.includes(utility));
			if (directives.length > 0) count++;
		}
	}
	return count;
}

describe('a class: directive never competes with a bare utility (#717)', () => {
	it('reads the token list out of layout.css', () => {
		// A broken read would empty the regex group and make every assertion below vacuous.
		expect(COLOUR_TOKENS.length).toBeGreaterThanOrEqual(30);
		expect(COLOUR_TOKENS).toContain('accent-bg');
		expect(COLOUR_TOKENS).toContain('panel-2');
	});

	it('finds the app it is walking', () => {
		expect(ALL.length).toBeGreaterThan(100);
		expect(ALL).toContain('lib/components/shell/Sidebar.svelte');
	});

	it('finds the elements that carry a class: directive at all', () => {
		const carriers = ALL.filter((file) =>
			PROPERTIES.some((property) => directive(property).test(markup(file)))
		);
		// A dozen or so wear one today; the floor is a tripwire on the regex, not a census.
		expect(carriers.length).toBeGreaterThanOrEqual(8);
		expect(carriers).toContain('lib/components/shell/Sidebar.svelte');
	});

	it('reads the tie in every spelling the attribute can take', () => {
		for (const shape of TYING_SHAPES) expect(tiesIn(shape), shape).toBe(1);
	});

	it('leaves alone the shapes that only look like it', () => {
		for (const shape of SAFE_SHAPES) expect(tiesIn(shape), shape).toBe(0);
	});

	it('spells no class: directive against a bare utility of the same property', () => {
		const offending = ALL_TIES.map(
			(tie) =>
				`${tie.file}:${tie.line} ${tie.property}: attribute has ${tie.attribute.join(',')}, directive adds ${tie.directive.join(',')}`
		);
		expect(offending).toEqual([]);
	});

	it('resolves a competing background inside cn, which is what the fix relies on', () => {
		// The pair #717 was about, spelled out rather than derived, so the assertion still
		// reads as the bug if the loop below is ever changed.
		expect(cn('bg-panel-2', 'bg-accent-bg')).toBe('bg-accent-bg');
		expect(cn('animate-in rounded-full bg-panel-2 text-label', 'bg-accent-bg')).toBe(
			'animate-in rounded-full text-label bg-accent-bg'
		);

		// And every other pair, because #653 is what happens when tailwind-merge classifies
		// one of this repo's tokens into a group nobody checked: an unknown `text-*` read as
		// a colour deleted the whole type scale, and the guard of the day read source text
		// and passed. A token that stopped being a `bg-color` would fail here instead.
		const unresolved: string[] = [];
		for (const property of PROPERTIES) {
			for (const first of COLOUR_TOKENS) {
				for (const second of COLOUR_TOKENS) {
					if (first === second) continue;
					const merged = cn(`${property}-${first}`, `${property}-${second}`);
					if (merged !== `${property}-${second}`) {
						unresolved.push(`${property}-${first} + ${property}-${second} => ${merged}`);
					}
				}
			}
		}
		expect(unresolved).toEqual([]);
	});

	it('keeps a variant out of the merge, which is why a variant is not the defect', () => {
		// The other half of the distinction: tailwind-merge must not collapse these, because
		// the hover rule is meant to win on specificity while the base one still applies.
		expect(cn('bg-panel-2', 'hover:bg-accent-bg')).toBe('bg-panel-2 hover:bg-accent-bg');
		expect(cn('bg-panel-2', 'focus-within:bg-accent-bg')).toBe(
			'bg-panel-2 focus-within:bg-accent-bg'
		);
	});
});
