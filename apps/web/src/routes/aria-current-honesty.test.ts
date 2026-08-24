/**
 * #724's rule, made checkable: **`aria-current="page"` may only be spelled where the
 * element's own href is the document the reader is on.** Everything else that marks
 * "the current one of these" spells `aria-current="true"`.
 *
 * The three values are not degrees of the same claim, they are different sentences, and
 * ARIA 1.2's own value table is what separates them: `page` is "the current page within
 * a set of pages", `location` is "the current location within an environment or
 * context", `true` is "the current item within a set". A screen reader says exactly
 * that. NVDA's own table (`source/controlTypes/isCurrent.py`) maps them to "current
 * page", "current location" and "current", and a11ysupport's recorded VoiceOver
 * macOS/Safari output for the three is "current page", "current location", "current".
 * All three are equally supported by JAWS, NVDA, TalkBack and VoiceOver, so support
 * decides nothing here and truth decides everything.
 *
 * What #724 measured, with the switcher open, from Chrome's AT-SPI2 tree (the platform
 * accessibility API a Linux screen reader consumes, where `aria-current` arrives as the
 * `current` object attribute, the same attribute name IAccessible2 carries on Windows):
 *
 * | document                          | row's uri            | current | true |
 * | --------------------------------- | -------------------- | ------- | ---- |
 * | `/w/valdoria-reach`               | `/w/valdoria-reach`  | `page`  | yes  |
 * | `/w/valdoria-reach/entries`       | `/w/valdoria-reach`  | `page`  | no   |
 * | `/w/valdoria-reach/proposals`     | `/w/valdoria-reach`  | `page`  | no   |
 *
 * And what #731 measured the same way, on the entries browser with 34 characters over two
 * pages, which is the second and last member of the class #724 found:
 *
 * | document                                 | chip's uri            | was    | true |
 * | ---------------------------------------- | --------------------- | ------ | ---- |
 * | `/entries?type=character`                | `?type=character`     | `page` | yes  |
 * | `/entries?type=character&page=2`         | `?type=character`     | `page` | no   |
 * | `/entries?page=2` (the All chip)         | `/entries`            | `page` | no   |
 *
 * `browseQuery` resets `page` on every chip href on purpose, so the href is right and the
 * value was what was wrong. It is `true` now, because a chip belongs to a set of filters
 * and the paginator beside it is the set of pages: adjacency to a set of pages does not
 * make a filter one of them.
 *
 * Two things this class of defect is invisible to, which is why it wants a test in the
 * tree rather than a gate. axe-core has no rule for an `aria-current` that lies: the
 * value is valid, the element is a link, nothing is malformed, and #730 is the standing
 * re-audit of what that gate does and does not see. And Chrome's CDP accessibility tree
 * does not carry `aria-current` at all: measured on Chrome 149 with
 * `--force-renderer-accessibility`, four links spelling `page`, `true`, `location` and
 * nothing serialise to byte-identical `Accessibility.getFullAXTree` nodes, so
 * `tab.observe()` and every puppeteer accessibility snapshot are blind to it too.
 *
 * The healthy shape is `PhoneNav.svelte`: it computes `active` as
 * `page.url.pathname === tab.href` and puts `page` on that, so the claim is about the
 * document being displayed and it is true whenever it is made.
 *
 * What this does not do is require the attribute to exist, and that hole is why #732
 * happened: a surface that marked "you are here" with weight alone and said nothing to a
 * screen reader passed here. The paired half now lives in
 * `class-directive-conflict.test.ts`, which fails a repeated control that paints a state
 * and announces none, so the two files together cover both directions: this one polices
 * what a spelled value claims, that one polices the absence.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));

/** This file spells every value it polices, because it is the guard. */
const SELF = 'routes/aria-current-honesty.test.ts';

/**
 * Where `page` is earned: the marked element's own href is compared against the current
 * URL, so the sentence is true whenever it is spoken.
 */
const URL_COMPARED: { file: string; reason: string }[] = [
	{
		file: 'lib/components/shell/PhoneNav.svelte',
		reason:
			'active = page.url.pathname === tab.href, and tab.href is the anchor href, so the ' +
			'tab marked current is the route being displayed.'
	},
	{
		file: 'lib/components/shell/Sidebar.svelte',
		reason:
			'#732: both navs compute active = page.url.pathname === href against the anchor ' +
			'own href, one for a universe seven places and one for the account three. An ' +
			'exact match, so on a descendant route (an entry under Entries) nothing is ' +
			'marked, which is what the paint already does.'
	},
	{
		file: 'lib/components/account/SettingsNav.svelte',
		reason:
			'#732: active = page.url.pathname === item.href, and every href is a real route ' +
			'rather than a same-page anchor, which is what separates this nav from ' +
			'UniverseSettingsRail below it.'
	},
	{
		file: 'lib/components/works/WorkTree.svelte',
		reason:
			'#732: active = node.id === activeNodeId, activeNodeId is page.params.node, and ' +
			'the href is built from the same work slug and node id, so the comparison is a ' +
			'URL comparison by route param rather than by pathname string.'
	}
];

/**
 * Where `page` is spelled without that comparison and was filed rather than fixed, each
 * with its issue, so nothing here quietly becomes the convention. A stale entry fails
 * below the same way a new unlisted one does.
 *
 * Empty since #731, and the emptiness is the assertion: every `page` left in the tree is
 * earned by a URL comparison. The slot stays because the next case wants a home that
 * carries an issue number rather than a shrug, which is what #724 filed this list for.
 */
const FILED: { file: string; reason: string }[] = [];

/** Every `.svelte` file under `apps/web/src`, relative to it. */
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
 * removed, so a line number this file reports is the line number the file has. Blanking
 * the script is also what keeps a doc comment that discusses the attribute, as
 * `UniverseSwitcher.svelte`'s now does, from reading as a use of it.
 */
function markup(file: string): string {
	const source = readFileSync(`${SRC}${file}`, 'utf-8');
	const blank = (match: string) => match.replace(/[^\n]/g, ' ');
	return source
		.replace(/<script[\s\S]*?<\/script>/g, blank)
		.replace(/<style[\s\S]*?<\/style>/g, blank)
		.replace(/<!--[\s\S]*?-->/g, blank);
}

/** A literal value, a quoted value, or a one-level Svelte expression, which is every
 * shape the tree uses: eight sites, all of them `cond ? 'value' : undefined`. */
const ARIA_CURRENT = /aria-current\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^{}]*)\})/g;

interface Use {
	file: string;
	line: number;
	values: string[];
}

/** Every `aria-current` in one file, with the values it can put on the element. */
function uses(file: string): Use[] {
	const source = markup(file);
	const out: Use[] = [];
	for (const match of source.matchAll(ARIA_CURRENT)) {
		const [, doubled, singled, expression] = match;
		const values =
			expression === undefined
				? [(doubled ?? singled ?? '').trim()]
				: [...expression.matchAll(/'([^']*)'|"([^"]*)"/g)].map((v) => v[1] ?? v[2]);
		out.push({
			file,
			line: source.slice(0, match.index).split('\n').length,
			values: values.filter(Boolean)
		});
	}
	return out;
}

const ALL_USES = ALL.filter((file) => file !== SELF).flatMap(uses);
const CLAIMS_PAGE = ALL_USES.filter((use) => use.values.includes('page'));
const LISTED = new Set([...URL_COMPARED, ...FILED].map((entry) => entry.file));

describe('aria-current says only what is true (#724)', () => {
	it('finds the app it is walking', () => {
		// A broken walk would make every assertion below pass by finding nothing.
		expect(ALL.length).toBeGreaterThan(100);
		expect(ALL).toContain('lib/components/shell/UniverseSwitcher.svelte');
	});

	it('finds every aria-current in the tree', () => {
		const files = [...new Set(ALL_USES.map((use) => use.file))].sort();
		expect(files).toEqual([
			'lib/components/account/SettingsNav.svelte',
			'lib/components/entries/TypeFilterRow.svelte',
			'lib/components/proposals/InlineProposalReview.svelte',
			'lib/components/proposals/TypeFilterChips.svelte',
			'lib/components/settings/UniverseSettingsRail.svelte',
			'lib/components/shell/PhoneNav.svelte',
			'lib/components/shell/ShellUserRow.svelte',
			'lib/components/shell/Sidebar.svelte',
			'lib/components/shell/UniverseSwitcher.svelte',
			'lib/components/table/TableDeck.svelte',
			'lib/components/works/WorkTree.svelte'
		]);
		expect(ALL_USES.length).toBe(14);
	});

	it('reads a value out of every shape the attribute is written in', () => {
		// Including the two this file does not need today, so a new site written either way
		// is read rather than skipped.
		const shapes: [string, string[]][] = [
			[`<a aria-current="page">x</a>`, ['page']],
			[`<a aria-current='true'>x</a>`, ['true']],
			[`<a aria-current={on ? 'page' : undefined}>x</a>`, ['page']],
			[`<a aria-current={on ? 'true' : undefined}>x</a>`, ['true']],
			[`<a aria-current={on ? 'location' : 'false'}>x</a>`, ['location', 'false']]
		];
		for (const [shape, expected] of shapes) {
			const match = [...shape.matchAll(ARIA_CURRENT)][0];
			expect(match, shape).toBeTruthy();
			const [, doubled, singled, expression] = match;
			const values =
				expression === undefined
					? [(doubled ?? singled ?? '').trim()]
					: [...expression.matchAll(/'([^']*)'|"([^"]*)"/g)].map((v) => v[1] ?? v[2]);
			expect(values.filter(Boolean), shape).toEqual(expected);
		}
	});

	it('claims page only where the href is compared against the current URL', () => {
		const offending = CLAIMS_PAGE.filter((use) => !LISTED.has(use.file)).map(
			(use) => `${use.file}:${use.line}`
		);
		expect(offending).toEqual([]);
	});

	it('keeps no entry that has stopped being real', () => {
		const live = new Set(CLAIMS_PAGE.map((use) => use.file));
		expect([...URL_COMPARED, ...FILED].filter((e) => !live.has(e.file)).map((e) => e.file)).toEqual(
			[]
		);
	});

	it('marks the current universe as the current item and not the current page', () => {
		// The subject of #724. The row's href is the universe home and the switcher opens
		// from every page inside that universe, so `page` is false on all but one route.
		const switcher = ALL_USES.filter(
			(use) => use.file === 'lib/components/shell/UniverseSwitcher.svelte'
		);
		expect(switcher.map((use) => use.values)).toEqual([['true']]);
	});

	it('marks the active entries chip as the current filter and not the current page', () => {
		// The subject of #731, and the reason `FILED` is empty. Both chips (All, and one per
		// browsable type) belong to a set of filters; the paginator beside them is the set of
		// pages. `browseQuery` resets `page` on every chip href, so on
		// /entries?type=character&page=2 the old `page` pointed at page 1 of the same filter,
		// which is a different page inside exactly the set the value is defined over. Measured
		// out of the AT-SPI tree, 34 characters over two pages.
		const chips = ALL_USES.filter(
			(use) => use.file === 'lib/components/entries/TypeFilterRow.svelte'
		);
		expect(chips.map((use) => use.values)).toEqual([['true'], ['true']]);
	});
});
