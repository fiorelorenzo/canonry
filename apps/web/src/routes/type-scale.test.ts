/**
 * Round seventeen V3 = B (#495, docs/design/DECISIONS.md): a type scale named by role
 * rather than by size, "because that is the only thing that stops the next arbitrary
 * value". #509 shipped the five tokens and migrated the sixty-six arbitrary bracket
 * sizes, which is the part it verified. It never touched Tailwind's default scale, so
 * the tokens existed and 651 sites across 143 files went on drawing type off
 * `text-xs`/`text-sm`/`text-base`/`text-lg`/`text-xl`/`text-2xl`, and
 * `--text-page-title`, the one token #509's own table said was replacing
 * `PageHeader`'s `h1`, had zero uses (#621).
 *
 * This is the guard that stops it drifting a third time, and it is the same shape as
 * `page-header-offset.test.ts`'s width guard for the same reason: the invariant is
 * "which class is spelled where", which is a fact about the source rather than about a
 * rendered browser, and this repo's `pnpm --filter web test` is vitest only.
 *
 * The rule it enforces: a default Tailwind text size in `apps/web/src` is either
 * migrated to a role token or listed below with a reason. `ALLOWED` is an exact
 * multiset, not a floor, so it fails in both directions - a new `text-sm` fails, and a
 * listed one that has since been migrated fails too, which is what keeps the list from
 * rotting into a set of stale excuses.
 *
 * Why the default `--text-*` namespace is not simply cleared in `@theme`, which #621
 * asked about and is the only version of this that needs no test: it cannot be, while
 * `ALLOWED` is non-empty. Every entry below is a site that still needs its default
 * utility to resolve, and the three groups they fall into are all the same finding,
 * that the scale has five roles and these sites want a sixth:
 *
 * - **A second heading level in markdown prose.** `EntryProse`, `EntryProseWithSecrets`
 *   and `DocPage` all draw `[&_h2]:text-xl [&_h3]:text-lg`, 20px over 18px over a 16px
 *   body, and `--text-title` is 18px. Putting both on it collapses two levels into one,
 *   on A1's reading surface, so the reading room keeps the ladder it has.
 * - **A display figure.** An accept rate, a credit balance, a price. It is not a
 *   label, a meta line, a body, a card title or a page title.
 * - **A wordmark.** A lockup is drawn to itself, not to a text role.
 *
 * All three are design questions in V3's own terms, "a size outside the five role
 * tokens is a design question, not a CSS one", so they belong in a decision row rather
 * than in a codemod. #649 carries them.
 *
 * One group that looked like a fourth and was not, because looking is what settled it.
 * `/w/[universe]/settings`, `/admin/metrics` and `/settings/billing` each draw a section
 * heading with card headings inside it, so when the section heading took `--text-title`
 * the card heading under it had nowhere to go, which is the collapse #509 predicted in
 * its own words: "the settings page's h2/h3 hierarchy would collapse if both landed on
 * --text-title". Leaving those nine on `text-sm`/`text-base` was the first answer and it
 * was wrong, and only a screenshot said so: once the body around them became 16px, a
 * 14px card heading was visibly SMALLER than the paragraph it headed, where on main the
 * two had been the same 14px and told apart by weight. So they take `--text-body` with
 * their `font-semibold` intact, a run-in heading at body size under an 18px section
 * heading, which is the shape `AskAnswerRow.svelte` already ships (`text-body
 * font-medium` on an `h2`). Three tokens, no sixth, and the ladder reads 18 / 16-bold /
 * 16 instead of 18 / 14-bold / 16.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { badgeVariants } from '$lib/components/ui/badge/badge.svelte';
import { TYPE_SCALE, cn } from '$lib/utils/cn';

/** Tailwind's whole default `text-*` size namespace, including the sizes this app has
 * never used, so adopting `text-3xl` tomorrow is a failure rather than a gap. */
const DEFAULT_SIZES = [
	'xs',
	'sm',
	'base',
	'lg',
	'xl',
	'2xl',
	'3xl',
	'4xl',
	'5xl',
	'6xl',
	'7xl',
	'8xl',
	'9xl'
] as const;

/** A utility, with any variant prefixes it carries (`md:`, `file:`, `focus:`,
 * `[&_h2]:`). The lookbehind is what keeps `max-w-xs` and `max-w-sm` out: those are
 * container widths and none of this is about them. */
const DEFAULT_SIZE = new RegExp(
	String.raw`(?<![\w-])(?:[A-Za-z0-9_\-[\]&:.]+:)*text-(${DEFAULT_SIZES.join('|')})(?![\w-])`,
	'g'
);

/**
 * Every remaining default size, with the reason it is not a role token. `count` is per
 * file and per utility, because three of these files carry the same utility on separate
 * lines and a count is the cheapest way to say "these three and no fourth".
 */
const ALLOWED: { file: string; util: string; count: number; reason: string }[] = [
	// A heading level below --text-title: markdown prose, in the reading room and in the
	// docs. h2/h3 are 20px/18px and --text-title is 18px, so migrating both flattens the
	// entry's own reading hierarchy to one level. A1 is the surface this product exists
	// for, so it keeps its ladder until a decision row says otherwise.
	{
		file: 'lib/components/entry/EntryProse.svelte',
		util: 'text-xl',
		count: 1,
		reason: 'markdown [&_h2] in the reading room, 20px above the 18px [&_h3] below it'
	},
	{
		file: 'lib/components/entry/EntryProse.svelte',
		util: 'text-lg',
		count: 1,
		reason: 'markdown [&_h3], the second prose heading level --text-title cannot also be'
	},
	{
		file: 'lib/components/players/EntryProseWithSecrets.svelte',
		util: 'text-xl',
		count: 1,
		reason: "the GM's own entry view draws the same prose ladder as EntryProse"
	},
	{
		file: 'lib/components/players/EntryProseWithSecrets.svelte',
		util: 'text-lg',
		count: 1,
		reason: "the GM's own entry view draws the same prose ladder as EntryProse"
	},
	{
		file: 'lib/components/docs/DocPage.svelte',
		util: 'text-xl',
		count: 1,
		reason: 'the docs draw the same prose ladder as EntryProse'
	},
	{
		file: 'lib/components/docs/DocPage.svelte',
		util: 'text-lg',
		count: 1,
		reason: 'the same ladder again, on a level no docs page ships an h3 for yet (#649)'
	},

	// A display figure. Not one of the five roles, and reading it as --text-title would
	// make the name lie about what the element is.
	{
		file: 'routes/admin/metrics/+page.svelte',
		util: 'text-2xl',
		count: 4,
		reason: 'the accept rate and its three counts, display numbers rather than titles'
	},
	{
		file: 'routes/settings/billing/+page.svelte',
		util: 'text-lg',
		count: 3,
		reason: 'credit balances, tabular figures rather than titles'
	},
	{
		file: 'routes/settings/billing/+page.svelte',
		util: 'text-2xl',
		count: 1,
		reason: 'a plan price, a display figure rather than a page title'
	},

	// A wordmark.
	{
		file: 'lib/components/auth/AuthShell.svelte',
		util: 'text-2xl',
		count: 1,
		reason: 'the Canonry wordmark on the signed-out door, a lockup rather than a text role'
	},
	{
		file: 'lib/components/shell/Sidebar.svelte',
		util: 'text-xs',
		count: 1,
		reason: 'the Canonry wordmark in the rail, a lockup rather than a label'
	},

	// Named in prose, never drawn. `found()` reads raw source rather than stripping
	// comments, for the reason its own doc comment gives, so a doc comment that names a
	// default utility lands here. Each of these three is a record of a measurement, and
	// rewriting the class name inside it would make the record say something that was
	// never measured.
	{
		file: 'lib/utils/cn.ts',
		util: 'text-xs',
		count: 1,
		reason: 'prose: why tailwind-merge kept text-xs but silently dropped text-label'
	},
	{
		file: 'lib/utils/cn.ts',
		util: 'text-sm',
		count: 1,
		reason: 'prose: the same paragraph, on what a second font size in one list conflicts with'
	},
	{
		file: 'routes/onboarding/+page.svelte',
		util: 'text-sm',
		count: 1,
		reason: 'prose: the deleted sm:grid-cols-3 card grid, whose problem was 14px in three columns'
	}
];

const SRC = fileURLToPath(new URL('..', import.meta.url));

/** Every `.svelte`/`.ts` file under `apps/web/src`, relative to it. `.ts` is in scope
 * because `lib/i18n/{en,it}.ts` carry class attributes inside translated HTML strings,
 * and eleven `<code class="text-xs">` in each of them were part of this drift. */
function sources(dir = '', out: string[] = []): string[] {
	for (const entry of readdirSync(`${SRC}${dir}`, { withFileTypes: true })) {
		const rel = `${dir}${entry.name}`;
		if (entry.isDirectory()) sources(`${rel}/`, out);
		else if (/\.(svelte|ts)$/.test(entry.name)) out.push(rel);
	}
	return out;
}

/** This file spells every default utility, in the regex and in the prose. Nothing else
 * may, outside `ALLOWED`. */
const SELF = 'routes/type-scale.test.ts';
const ALL = sources().filter((f) => f !== SELF);

/**
 * `file\tutil` -> count, over the raw source of the whole app.
 *
 * Raw on purpose, and this was the second attempt. `page-header-offset.test.ts` strips
 * comments before matching, so that a doc comment naming a class is not mistaken for a
 * component drawing it, and copying that here was wrong: regex comment-stripping is not
 * safe on this codebase. Several doc comments contain the route glob `/p/**`, whose
 * `/*` opens a block comment that then closes at the next real terminator and swallows
 * the markup in between, which is how `EntryProseWithSecrets`'s whole prose class list
 * disappeared from this guard. Measured across `apps/web/src`, stripping block comments
 * loses a real `class=` attribute in 6 files, and stripping line comments first to
 * defuse those globs loses one in 11.
 *
 * So nothing is stripped and the few files that name a default utility in prose are
 * listed in `ALLOWED` like anything else. That trades three allowlist entries for the
 * property that actually matters: this guard can over-report, and it can never silently
 * miss a component that draws off the default scale.
 */
function found(): Map<string, number> {
	const out = new Map<string, number>();
	for (const file of ALL) {
		const source = readFileSync(`${SRC}${file}`, 'utf-8');
		for (const match of source.matchAll(DEFAULT_SIZE)) {
			const key = `${file}\ttext-${match[1]}`;
			out.set(key, (out.get(key) ?? 0) + 1);
		}
	}
	return out;
}

describe('the type scale is spelled in role tokens, or listed with a reason (V3 = B, #495, #621)', () => {
	it('finds the app it is walking', () => {
		// A broken walk would make every assertion below pass by finding nothing.
		expect(ALL.length).toBeGreaterThan(200);
		expect(ALL).toContain('lib/components/ui/page/page-width.ts');
		expect(ALL).toContain('lib/i18n/en.ts');
	});

	it('the guard itself matches a utility, a variant-prefixed one, and no container width', () => {
		const hit = (s: string) => [...s.matchAll(DEFAULT_SIZE)].map((m) => m[0]);
		expect(hit('class="text-sm text-ink"')).toEqual(['text-sm']);
		expect(hit('class="md:text-sm file:text-base [&_h2]:text-xl"')).toEqual([
			'md:text-sm',
			'file:text-base',
			'[&_h2]:text-xl'
		]);
		expect(hit('class="max-w-xs max-w-sm max-w-2xl text-label"')).toEqual([]);
	});

	it('uses no default Tailwind text size outside the allowlist', () => {
		const rows = (entries: Iterable<[string, number]>) =>
			[...entries]
				.map(([key, n]) => `${key.replace('\t', ' ')} x${n}`)
				.sort()
				.join('\n');
		const expected = ALLOWED.map((a) => [`${a.file}\t${a.util}`, a.count] as [string, number]);
		expect(rows(found())).toBe(rows(expected));
	});

	it('gives every allowlist entry a reason', () => {
		for (const entry of ALLOWED) {
			expect(entry.reason.length, `${entry.file} ${entry.util}`).toBeGreaterThan(20);
			expect(entry.count).toBeGreaterThan(0);
		}
	});

	// The band's own path is derived from the walk rather than written out, because
	// `page-header-offset.test.ts` guards that only `page.svelte` and the gallery name
	// it, and a string in this file's code counts.
	it('--text-page-title has a consumer, which is what #621 was opened about', () => {
		const band = ALL.find((f) => f.endsWith('page-band.svelte'));
		expect(band).toBeDefined();
		const src = readFileSync(`${SRC}${band}`, 'utf-8');
		// #728: the title element is a `<svelte:element>` now, not a literal `<h1>`, because
		// `dev/ui` renders the band inside itself and needed a deeper level (page-band.svelte
		// says why). What #621 is about is unchanged: the token has to sit on whatever
		// heading the band resolves to, so this matches the element rather than the tag.
		expect(src).toMatch(/this=\{`h\$\{headingLevel\}`\}[^>]*class="text-page-title/);
		// And the default has to stay 1, or every real route silently loses its `<h1>`.
		expect(src).toMatch(/headingLevel = 1\b/);
		const consumers = ALL.filter((f) =>
			/\btext-page-title\b/.test(readFileSync(`${SRC}${f}`, 'utf-8'))
		);
		expect(consumers).toContain(band);
	});
});

/**
 * The other half of "the scale is applied", and the half that had been quietly false
 * since #509. Spelling `text-label` on an element is not enough: `cn` and
 * `tailwind-variants` both run the class list through tailwind-merge, whose `text-*`
 * heuristic reads an unrecognised suffix as a COLOUR, so a role token and a colour on
 * one element are treated as one conflict and the token is deleted. `EntryTable`'s
 * `<th>` and every `Badge` in the app rendered at their inherited size for exactly that
 * reason, measured at 16px against a token that says 12px, and it hid behind the fact
 * that `text-xs` (a suffix tailwind-merge does know) used to survive the same merge.
 *
 * So these assert the wiring rather than the spelling: the list `cn.ts` declares is the
 * list `@theme` defines, and a token really does survive a merge beside a colour.
 */
describe('the scale survives tailwind-merge (#621)', () => {
	it('cn.ts declares exactly the --text-* tokens layout.css defines', () => {
		const theme = readFileSync(`${SRC}routes/layout.css`, 'utf-8');
		const declared = [...theme.matchAll(/^\s*--text-([\w-]+):/gm)]
			.map((m) => m[1])
			.filter((name) => !name.endsWith('--line-height'));
		expect([...TYPE_SCALE].sort()).toEqual([...new Set(declared)].sort());
	});

	it('keeps a role token next to a text colour, and lets two tokens conflict', () => {
		expect(cn('text-label font-semibold text-muted uppercase').split(' ')).toContain('text-label');
		expect(cn('text-meta', 'text-accent-ink').split(' ')).toContain('text-meta');
		// Two sizes on one element is a real conflict, and the later one has to win
		// rather than both surviving for CSS order to decide.
		expect(cn('text-sm', 'text-body')).toBe('text-body');
		expect(cn('text-title', 'text-body')).toBe('text-body');
		// A colour is still just a colour.
		expect(cn('text-ink', 'text-muted')).toBe('text-muted');
	});

	it('Badge keeps its --text-label through tailwind-variants', () => {
		// tailwind-variants holds its own tailwind-merge instance, so this is a separate
		// wiring from `cn` and was separately broken.
		expect(badgeVariants({ variant: 'secondary' }).split(' ')).toContain('text-label');
		expect(badgeVariants({ variant: 'default' }).split(' ')).toContain('text-label');
	});
});
