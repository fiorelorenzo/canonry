/**
 * Round seventeen V3 = B (#495, docs/ux/DECISIONS.md): a type scale named by role
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
 * - **A heading level below `--text-title`.** Markdown prose gets two heading levels
 *   under the page title (`h2` 20px, `h3` 18px) and the scale names one, 18px. Putting
 *   both on it collapses two levels into one, on A1's reading surface, so the reading
 *   room keeps the ladder it has. The same thing happens on the three surfaces that
 *   draw a section heading and a card heading inside it: the section heading takes
 *   `--text-title` (it was already 18px, so nothing moved) and the card heading under
 *   it has nowhere to go. #509 predicted exactly this one, in its own words, "the
 *   settings page's h2/h3 hierarchy would collapse if both landed on --text-title".
 * - **A display figure.** An accept rate, a credit balance, a price. It is not a
 *   label, a meta line, a body, a card title or a page title.
 * - **A wordmark.** A lockup is drawn to itself, not to a text role.
 *
 * All three are design questions in V3's own terms, "a size outside the five role
 * tokens is a design question, not a CSS one", so they belong in a decision row rather
 * than in a codemod. #649 carries them.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
		reason: "the players' wiki draws the same prose ladder as EntryProse"
	},
	{
		file: 'lib/components/players/EntryProseWithSecrets.svelte',
		util: 'text-lg',
		count: 1,
		reason: "the players' wiki draws the same prose ladder as EntryProse"
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
		reason: 'the docs draw the same prose ladder as EntryProse'
	},

	// A heading level below --text-title: the three surfaces that draw a section heading
	// with card headings inside it. The section heading took --text-title and was already
	// 18px, so nothing on these pages moved; the card heading under it is the level the
	// scale does not name, and #509 named this exact collapse before it happened.
	{
		file: 'routes/w/[universe]/settings/+page.svelte',
		util: 'text-sm',
		count: 6,
		reason: 'a card heading inside a --text-title group heading (images, loremaster, canon)'
	},
	{
		file: 'routes/admin/metrics/+page.svelte',
		util: 'text-sm',
		count: 2,
		reason: 'a subsection heading inside a --text-title section heading'
	},
	{
		file: 'routes/settings/billing/+page.svelte',
		util: 'text-base',
		count: 1,
		reason: "a plan card's name inside the --text-title plans heading"
	},

	// A display figure. Not one of the five roles, and reading it as --text-title would
	// make the name lie about what the element is.
	{
		file: 'routes/admin/metrics/+page.svelte',
		util: 'text-2xl',
		count: 4,
		reason: 'the four accept-rate figures, a display number rather than a title'
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

	// Not markup at all: a doc comment describing the card grid #575 deleted, whose
	// problem was three columns of 14px type. Rewriting the class name inside it would
	// make the record of what was measured say something that was never measured.
	{
		file: 'routes/onboarding/+page.svelte',
		util: 'text-sm',
		count: 1,
		reason: 'prose in a doc comment recording the deleted sm:grid-cols-3 card grid'
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

/** `file\tutil` -> count, over the whole app. */
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
		expect(readFileSync(`${SRC}${band}`, 'utf-8')).toMatch(/<h1 class="text-page-title/);
		const consumers = ALL.filter((f) =>
			/\btext-page-title\b/.test(readFileSync(`${SRC}${f}`, 'utf-8'))
		);
		expect(consumers).toContain(band);
	});
});
