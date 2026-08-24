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
 * A **variant** is decidable rather than a coin flip, and this is the distinction #717
 * turned on: `hover:bg-panel-2` beside `class:bg-accent-bg` is not a tie, because `hover:`
 * adds a pseudo-class and therefore specificity, so the hover rule wins whenever it applies
 * and the directive wins the rest of the time. The tie check below only looks at bare
 * utilities for that reason.
 *
 * Decidable is not the same as harmless, which #720 is the proof of and which this file
 * claimed the opposite of until it was written. `UniverseSwitcher.svelte`'s row spells
 * `hover:bg-panel-2` in the attribute and `class:bg-accent-bg={isCurrent}` beside it:
 * `.hover\:bg-panel-2:hover` is (0,2,0) against `.bg-accent-bg`'s (0,1,0), so hover wins
 * whenever it applies and the row that says "you are here" loses the thing that says it
 * exactly while the pointer is on it. Measured `rgb(243, 231, 213)` resting and
 * `rgb(249, 244, 234)` hovered, and with the pointer on it the row is identical on every
 * computed property to a hovered row that is not current.
 *
 * So there is a second rule, and the second half of this file holds it: **a marker that is
 * only present in one state must not be overwritable by a variant of the same property on
 * the same element.** The healthy way round is the one `segmented.svelte` and the settings
 * radio cards use, the resting value bare and the state marker in the variant
 * (`border-line` plus `has-checked:border-accent`), where specificity runs with the intent
 * instead of against it. Forty-six elements pair a bare colour with a variant of the same
 * property, and forty-five of them are that: an unconditional resting value a hover
 * temporarily replaces, which loses nothing because the base comes back. Only a
 * *conditional* bare marker loses information when a variant beats it, and exactly one
 * element in the tree is that shape.
 *
 * Which way #720 should be resolved is a taste call and not this file's business, so the
 * inventory is an expected set rather than a prohibition: a new instance of the shape
 * fails, and so does resolving this one, which is the PR that should be editing the set.
 *
 * ## Three checks, because one of them is #653's blind spot
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
 * The third is #720's inventory. It reads the same markup and asks a narrower question: is
 * this element's state marker bare while a variant of the same property sits beside it?
 * That is source text again, and it can only ever say the erasure is possible; the computed
 * backgrounds in #720 are what say it happens.
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
 * 7. **Whether a conditional literal is really conditional.** The inventory treats a
 *    `class:` directive and a literal guarded by `&&` or held in a ternary branch as state
 *    markers, and everything else in the class expression as unconditional. A marker built
 *    some other way, a variable holding the token or a helper returning it, is invisible,
 *    and a ternary whose two branches are two spellings of the same resting value would be
 *    read as conditional and could produce a false entry.
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

/**
 * The mirror of `bare`: the same utility carrying at least one variant prefix, which is
 * what buys it the extra specificity. `hover:`, `focus-within:`, `has-checked:`,
 * `dark:aria-invalid:` and an arbitrary-selector variant like `[&_svg]:` all match, which
 * is why a prefix segment may be a bracket group rather than a word.
 */
const varied = (property: string) =>
	new RegExp(
		String.raw`(?<![\w-])(?:(?:[a-z][\w-]*(?:\[[^\]]*\])?|\[[^\]]*\]):)+${property}-(?:${GROUP})(?![\w-])`,
		'g'
	);

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
 * A `class={...}` expression's own body. The `|$` in the lookahead matters: `TAG` consumes
 * the closing `>`, so on an element whose only attribute is a `class` expression the `}` is
 * the last character of what this ever sees, and without it such an element reads as having
 * no class at all. Every element in the tree carries something after it, which is why the
 * hole showed up in a #720 fixture rather than in the walk.
 */
const CLASS_EXPRESSION = /(?<![\w-:])class\s*=\s*\{([\s\S]*?)\}\s*(?=[\s/>]|$)/g;

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
	for (const match of attrs.matchAll(CLASS_EXPRESSION)) {
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

/**
 * One element's class list broken into the pieces that can be on it at the same time.
 * `ternary` is an id shared by the two branches of one `cond ? 'a' : 'b'`, which is the
 * only thing here that makes two pieces mutually exclusive; `stateful` is whether the piece
 * can be absent, which is what makes a bare utility inside it a marker rather than a
 * resting value.
 */
interface Piece {
	classes: string;
	ternary: number | null;
	branch: number | null;
	stateful: boolean;
}

/**
 * Every piece of one element's class list. A `class:` directive is a stateful piece of its
 * own. Inside `class={...}`, a ternary contributes two exclusive stateful pieces, a literal
 * guarded by `&&` one stateful piece, and everything else left over is the unconditional
 * resting value, which a variant beating loses nothing: that is what forty-five of the
 * forty-six variant-versus-bare pairs in this tree are.
 */
function pieces(attrs: string): Piece[] {
	const out: Piece[] = [];
	let ternaries = 0;

	for (const match of attrs.matchAll(/class:([\w-]+)/g)) {
		out.push({ classes: match[1], ternary: null, branch: null, stateful: true });
	}

	for (const match of attrs.matchAll(/(?<![\w-:])class\s*=\s*("([^"]*)"|'([^']*)')/g)) {
		out.push({ classes: match[2] ?? match[3], ternary: null, branch: null, stateful: false });
	}

	for (const match of attrs.matchAll(CLASS_EXPRESSION)) {
		let rest = match[1];
		rest = rest.replace(
			/\?\s*(['"`])([^'"`]*)\1\s*:\s*(['"`])([^'"`]*)\3/g,
			(_whole, _q1, first: string, _q2, second: string) => {
				const id = ternaries++;
				out.push({ classes: first, ternary: id, branch: 0, stateful: true });
				out.push({ classes: second, ternary: id, branch: 1, stateful: true });
				return ' ';
			}
		);
		rest = rest.replace(/&&\s*(['"`])([^'"`]*)\1/g, (_whole, _quote, only: string) => {
			out.push({ classes: only, ternary: null, branch: null, stateful: true });
			return ' ';
		});
		for (const literal of rest.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)) {
			out.push({
				classes: literal[1] ?? literal[2] ?? literal[3] ?? '',
				ternary: null,
				branch: null,
				stateful: false
			});
		}
	}
	return out;
}

interface Erasure {
	file: string;
	line: number;
	property: string;
	marker: string[];
	erasedBy: string[];
}

/**
 * Every element whose state marker for a property is bare while a variant of that same
 * property can be on the element at the same time under a different token. The variant wins
 * on specificity, so the marker is invisible in exactly the state the variant describes.
 *
 * The co-possibility test is the load-bearing part rather than a refinement: two pieces that
 * are the branches of one ternary never meet, so `cn('px-3', isCurrent ? 'bg-accent-bg' :
 * 'hover:bg-panel-2')` is not this defect. That happens to be one of the ways #720 could be
 * resolved, and a detector without the test would fail the PR that fixed it.
 */
function erasures(source: string, file: string): Erasure[] {
	const found: Erasure[] = [];

	for (const match of source.matchAll(TAG)) {
		const [, closing, , attrs] = match;
		if (closing) continue;
		const parts = pieces(attrs);

		for (const property of PROPERTIES) {
			const marker = new Set<string>();
			const erasedBy = new Set<string>();
			for (const holder of parts) {
				if (!holder.stateful) continue;
				for (const hit of holder.classes.matchAll(bare(property))) {
					for (const other of parts) {
						if (
							holder.ternary !== null &&
							holder.ternary === other.ternary &&
							holder.branch !== other.branch
						) {
							continue;
						}
						for (const rival of other.classes.matchAll(varied(property))) {
							if (rival[0].slice(rival[0].lastIndexOf(':') + 1) === hit[0]) continue;
							marker.add(hit[0]);
							erasedBy.add(rival[0]);
						}
					}
				}
			}
			if (marker.size === 0) continue;
			found.push({
				file,
				line: source.slice(0, match.index).split('\n').length,
				property,
				marker: [...marker],
				erasedBy: [...erasedBy]
			});
		}
	}
	return found;
}

const ALL_ERASURES = ALL.flatMap((file) => erasures(markup(file), file));

/**
 * The inventory as it stands, and the only entry is #720's. It is spelled out rather than
 * counted so that the failure names the element, and it carries the issue that owns it so a
 * reader knows the entry is a filed decision rather than an oversight. Resolving #720 either
 * way empties this list, and the PR that does it edits this constant.
 */
const KNOWN_ERASURES = [
	'lib/components/shell/UniverseSwitcher.svelte bg: bg-accent-bg erased by hover:bg-panel-2 (#720)'
];

/** The shape the detector must catch, and the near misses it must not. */
const ERASING_SHAPES = [
	'<a class="px-3 hover:bg-panel-2" class:bg-accent-bg={isCurrent}>x</a>',
	"<a class={cn('px-3 hover:bg-panel-2', isCurrent && 'bg-accent-bg')}>x</a>",
	"<a class={cn('px-3 hover:bg-panel-2', isCurrent ? 'bg-accent-bg' : 'bg-panel')}>x</a>"
];

const NON_ERASING_SHAPES = [
	// The healthy way round: resting value bare, state marker in the variant, so specificity
	// runs with the intent. This is `segmented.svelte` and the settings radio cards.
	'<label class="border-line has-checked:border-accent">x</label>',
	// An unconditional resting colour a hover replaces: the base comes back, nothing is lost.
	'<a class="text-ink-2 hover:text-ink">x</a>',
	// Same token on both sides, so there is nothing to erase.
	'<a class="hover:bg-panel-2" class:bg-panel-2={active}>x</a>',
	// A marker with no variant of its property beside it.
	'<a class="px-3 hover:text-ink" class:bg-accent-bg={active}>x</a>',
	// Exclusive branches: the hover utility is never on the element that carries the marker,
	// which is one of the shapes #720 could be resolved into.
	"<a class={cn('px-3', isCurrent ? 'bg-accent-bg' : 'hover:bg-panel-2')}>x</a>"
];

/** The fixtures go through the same detector the walk uses, rather than a second copy of it
 * that could drift into agreeing with itself. */
function erasuresIn(fragment: string): number {
	return erasures(fragment, '<fixture>').length;
}

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

describe('a bare state marker a variant can erase is inventoried, not silent (#720)', () => {
	it('catches the shape in each channel a marker can arrive through', () => {
		for (const shape of ERASING_SHAPES) expect(erasuresIn(shape), shape).toBe(1);
	});

	it('leaves alone the pairs that lose nothing', () => {
		for (const shape of NON_ERASING_SHAPES) expect(erasuresIn(shape), shape).toBe(0);
	});

	it('reads a variant prefix on every spelling the tree uses', () => {
		// A `varied` regex that stopped matching would empty the inventory and make the
		// assertion below pass for the wrong reason, so the prefixes get asserted directly.
		const spellings: [string, string][] = [
			['bg', 'hover:bg-panel-2'],
			['bg', 'focus-within:bg-accent-bg'],
			['border', 'has-checked:border-accent'],
			['border', 'has-[:checked]:border-accent'],
			['border', 'dark:aria-invalid:border-destructive'],
			['text', '[&_svg]:text-ink']
		];
		for (const [property, utility] of spellings) {
			expect([...utility.matchAll(varied(property))], utility).toHaveLength(1);
		}
		// And the bare spelling of the same utility is not a variant.
		expect([...'bg-panel-2'.matchAll(varied('bg'))]).toHaveLength(0);
		expect([...'border-accent'.matchAll(varied('border'))]).toHaveLength(0);
	});

	it('holds the inventory to the one entry #720 owns', () => {
		const found = ALL_ERASURES.map(
			(erasure) =>
				`${erasure.file} ${erasure.property}: ${erasure.marker.join(',')} erased by ${erasure.erasedBy.join(',')}`
		);
		// Not a prohibition: which way #720 goes is a taste call. A second instance appearing,
		// or this one being resolved, both belong in a PR that edits KNOWN_ERASURES.
		expect(found).toEqual(KNOWN_ERASURES.map((entry) => entry.replace(' (#720)', '')));
	});
});

/**
 * #732's rule, and the natural other half of the two above: **a control that paints one
 * member of a set as the current one must also say so.** #717 and #720 are both about a
 * marker the eye cannot see; this is about a marker only the eye can see.
 *
 * The precondition is set membership, which is why the walk below only looks at controls
 * inside an `{#each}`: `aria-current` is defined as "the current one within a set", so a
 * lone control carrying a stateful colour is far more often a status or a validation tint
 * (an accepted proposal's green, an over-ceiling amber) than a claim about which of several
 * things you are on, and requiring an announcement there would be wrong rather than noisy.
 * Inside a repeated block the marker distinguishes siblings by construction.
 *
 * Which announcement satisfies it is deliberately not decided here, because the tree has
 * three honest answers and they are not interchangeable: `aria-current` for the current one
 * of a set (`page` when the marked control's own href is the document being displayed,
 * `true` otherwise, which is `aria-current-honesty.test.ts`'s subject and #724's rule),
 * `aria-pressed` for a toggle, `aria-selected` for an option inside a listbox. Any of the
 * four attributes counts, and which one is right is a code-review question.
 */

/** The offsets of every `{#each}` block, so a tag can be asked whether it repeats. */
function eachSpans(source: string): [number, number][] {
	const spans: [number, number][] = [];
	const open: number[] = [];
	for (const match of source.matchAll(/\{#each\b|\{\/each\}/g)) {
		if (match[0] === '{/each}') {
			const start = open.pop();
			if (start !== undefined) spans.push([start, match.index]);
		} else open.push(match.index);
	}
	return spans;
}

/**
 * Whether any piece of this element's class list that is *conditional* names a colour, in
 * any of the three properties and either bare or under a variant. `pieces` is the same
 * function #720's half uses, so "conditional" means exactly what it means there: a `class:`
 * directive, a literal guarded by `&&`, or a branch of a ternary. An unconditional class is
 * the resting look and marks nothing.
 */
function paintsAState(attrs: string): boolean {
	return pieces(attrs).some(
		(piece) =>
			piece.stateful &&
			PROPERTIES.some(
				(property) => bare(property).test(piece.classes) || varied(property).test(piece.classes)
			)
	);
}

const ANNOUNCES = /(?<![\w-])aria-(?:current|pressed|selected|sort)\s*=/;

interface Silence {
	file: string;
	line: number;
	tag: string;
}

/** Every repeated control that paints a state and announces none. */
function silences(source: string, file: string): Silence[] {
	const spans = eachSpans(source);
	const found: Silence[] = [];
	for (const match of source.matchAll(TAG)) {
		const [, closing, tag, attrs] = match;
		// An anchor with an href, or a button: a `<li>` or a `<span>` wrapping one is not the
		// element an assistive technology reports, so the attribute belongs on these two.
		if (closing || !(tag === 'button' || (tag === 'a' && /(?<![\w-])href/.test(attrs)))) continue;
		if (!spans.some(([from, to]) => match.index > from && match.index < to)) continue;
		if (!paintsAState(attrs) || ANNOUNCES.test(attrs)) continue;
		found.push({ file, line: source.slice(0, match.index).split('\n').length, tag });
	}
	return found;
}

const ALL_SILENCES = ALL.flatMap((file) => silences(markup(file), file));

/**
 * The inventory, one entry, spelled out so the failure names the element. The entries table's
 * sort headers paint the sorted column (`class:text-ink={active}`) and add an `aria-hidden`
 * direction arrow, so neither the column nor the direction reaches a screen reader. It is
 * filed rather than fixed because the fix is a different attribute in a different place:
 * `aria-sort` belongs on the `<th>` ancestor and not on the link this walk found, and it has
 * to carry ascending/descending rather than a boolean, which is a change to what the header
 * renders and not one line on a control.
 */
const KNOWN_SILENT = ['lib/components/entries/EntryTable.svelte:182 <a> (#750, wants aria-sort)'];

/** The shape the detector must catch. */
const SILENT_SHAPES = [
	`{#each xs as x}<a href="/a" class:text-ink={x.id === cur}>x</a>{/each}`,
	`{#each xs as x}<a href="/a" class:bg-accent-bg={x.on} class:bg-panel={!x.on}>x</a>{/each}`,
	`{#each xs as x}<button class={cn('px-2', x.id === cur && 'bg-accent-bg')}>x</button>{/each}`,
	`{#each xs as x}<button class={cn(x.id === cur ? 'bg-accent-bg' : 'hover:bg-panel-2')}>x</button>{/each}`
];

/** Shapes that look like it and are not, each for a different reason. */
const ANNOUNCED_SHAPES = [
	// Announced, in each of the four attributes that count.
	`{#each xs as x}<a href="/a" class:text-ink={x.on} aria-current={x.on ? 'page' : undefined}>x</a>{/each}`,
	`{#each xs as x}<button class:border-accent={x.on} aria-pressed={x.on}>x</button>{/each}`,
	`{#each xs as x}<button class:bg-accent-bg={x.on} aria-selected={x.on}>x</button>{/each}`,
	`{#each xs as x}<a href="/a" class:text-ink={x.on} aria-sort="ascending">x</a>{/each}`,
	// Paints nothing conditional: the colours are the resting look.
	`{#each xs as x}<a href="/a" class="text-ink-2 hover:bg-panel-2">x</a>{/each}`,
	// Conditional, but not a colour: a layout or a size cannot be a "you are here" marker.
	`{#each xs as x}<a href="/a" class:font-semibold={x.on} class:pl-4={x.on}>x</a>{/each}`,
	// Not a control: the attribute belongs on the anchor inside, not on the row.
	`{#each xs as x}<li class:bg-accent-bg={x.on}><a href="/a">x</a></li>{/each}`,
	// An anchor with no href is not a control either.
	`{#each xs as x}<a class:text-ink={x.on}>x</a>{/each}`,
	// Outside any {#each}: the blind spot this walk accepts, asserted so it stays known.
	`<a href="/a" class:text-ink={isAll}>All</a>`
];

function silencesIn(fragment: string): number {
	return silences(fragment, '<fixture>').length;
}

describe('a repeated control that paints a state announces one (#732)', () => {
	it('catches the shape in each channel a marker can arrive through', () => {
		for (const shape of SILENT_SHAPES) expect(silencesIn(shape), shape).toBe(1);
	});

	it('leaves alone what is announced, unconditional, colourless or not a control', () => {
		for (const shape of ANNOUNCED_SHAPES) expect(silencesIn(shape), shape).toBe(0);
	});

	it('finds the {#each} blocks it depends on', () => {
		// A broken span scan would empty the walk and make the assertion below pass by
		// finding nothing, which is the failure mode this whole file is built against.
		// `{#each a as b}` is 14 characters, `x` is at 14, so `{/each}` opens at 15.
		expect(eachSpans(`{#each a as b}x{/each}`)).toEqual([[0, 15]]);
		expect(eachSpans(`{#each a as b}{#each c as d}x{/each}{/each}`)).toHaveLength(2);
		expect(eachSpans('no blocks here')).toEqual([]);
		expect(eachSpans(markup('lib/components/shell/Sidebar.svelte')).length).toBeGreaterThanOrEqual(
			2
		);
	});

	it('holds the inventory to the one entry that is filed', () => {
		const found = ALL_SILENCES.map((silence) => `${silence.file}:${silence.line} <${silence.tag}>`);
		expect(found).toEqual(KNOWN_SILENT.map((entry) => entry.replace(/ \(#\d+.*\)$/, '')));
	});
});
