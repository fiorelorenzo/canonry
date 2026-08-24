/**
 * #652's guard, and it is one rule rather than one route's fix.
 *
 * `/admin/models` scrolled the whole document sideways, 175px at 390 and 69px at 768,
 * with both of its tables already inside an `overflow-x-auto` wrapper. The element that
 * escaped the wrapper was the `<span class="sr-only">` naming each table's actions
 * column: `sr-only` is `position: absolute`, the wrapper was not a containing block, so
 * the span's containing block was the initial one, its box stayed at the table's
 * un-scrolled right edge (565px into a 390px viewport), and the root's scrollable
 * overflow grew to reach it. An absolutely positioned element is only clipped by a
 * scroll container that sits in its containing block chain, which is what makes this a
 * property of the container and not of the span: a popover, a focus ring or a badge
 * inside one of these would have done exactly the same thing.
 *
 * So the rule is that an element that scrolls horizontally is also a containing block,
 * and it is checkable by reading the class list it declares. Repo-wide and by directory
 * walk rather than by a list, for `page-header-offset.test.ts`'s reason: a list is the
 * thing a new component is added without.
 *
 * The second assertion is why `TableScroll` exists at all. The wrapper was written out
 * by hand ten times across four files before this, so the next table would have got
 * nine correct copies and one without the word, which is how this defect arrived. A
 * file that draws a `<table>` does not spell the scroll container itself.
 *
 * #725 adds the second rule about the same containers, for the same reason at the same
 * level: an element that scrolls horizontally has to be reachable from a keyboard. Three
 * of the five tables `/admin/metrics` draws overflow at 390 and 768 with zero focusable
 * descendants, so a pointer could drag them and a keyboard could not reach them at all
 * (axe `scrollable-region-focusable`, `serious`, WCAG 2.1.1). `keyboardScrollable`
 * (`$lib/utils/keyboard-scrollable.ts`) is the one implementation, so the rule here is
 * that the element declaring the scroll also applies that action.
 *
 * The two exceptions are listed rather than inferred, and the polarity matters: the
 * default is that the action is required, so a new scroller that forgets it fails without
 * anybody updating a list. Only a deliberate exception needs an entry.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));

/** This file spells every pattern it forbids, because it is the guard. */
const SELF = 'routes/horizontal-scroll-container.test.ts';

/** The component that owns the container, and the one place it is spelled. */
const TABLE_SCROLL = 'lib/components/ui/table/table-scroll.svelte';

const SCROLLS_X = /\boverflow-x-(?:auto|scroll)\b/;

/** `relative` is what every call site here uses; the other three are containing blocks
 * for an absolutely positioned descendant just as well, so the rule accepts them rather
 * than mandating one spelling of it. `static` is the default and the defect. */
const CONTAINING_BLOCK = /\b(?:relative|absolute|fixed|sticky)\b/;

/** #725: the action that puts an overflowing scroll container in the tab order. */
const KEYBOARD_SCROLLABLE = /\buse:keyboardScrollable\b/;

/** The two horizontal scrollers that do not need it, with the reason, because "it has
 * focusable content" is not by itself a reason: measured on `/admin/pricing` at 390, all
 * 24, 36 and 3 focusables of its three tables sit in the first column and 476px of a 649px
 * table could not be reached by tabbing. What earns an exception is children that are
 * *individually* focusable all the way along the scroll, so tabbing through them traverses
 * the whole extent and adding a stop on the container would only be a stop before the
 * strip. Keyed by element as well as by file, so a second scroller added to either of
 * these files is not silently exempt too. */
const SPANNED_BY_FOCUSABLE_CHILDREN: ReadonlyArray<{ file: string; tag: string }> = [
	// A `<button>` per card, one for the place and one per pin.
	{ file: 'lib/components/table/TableDeck.svelte', tag: 'nav' },
	// An `<a>` per entry card.
	{ file: 'lib/components/entries/ContinueRow.svelte', tag: 'ul' }
];

/** Every `.svelte`/`.ts` file under `apps/web/src`, relative to it. */
function sources(dir = '', out: string[] = []): string[] {
	for (const entry of readdirSync(`${SRC}${dir}`, { withFileTypes: true })) {
		const rel = `${dir}${entry.name}`;
		if (entry.isDirectory()) sources(`${rel}/`, out);
		else if (/\.(svelte|ts)$/.test(entry.name)) out.push(rel);
	}
	return out;
}

function withoutComments(source: string): string {
	return source
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/^[ \t]*(?:\/\/|\*).*$/gm, '');
}

const ALL = sources().filter((file) => file !== SELF);
const code = (file: string) => withoutComments(readFileSync(`${SRC}${file}`, 'utf-8'));

/** Every quoted class list in a file that carries a horizontal scroll utility. A class
 * list built by `cn(...)` is a string literal too, so both spellings are read the same
 * way; a list assembled from several literals would slip past this, and there is none. */
function scrollingClassLists(source: string): string[] {
	return [...source.matchAll(/(['"`])([^'"`\n]*)\1/g)]
		.map((match) => match[2])
		.filter((list) => SCROLLS_X.test(list));
}

/**
 * Every opening tag in a file, as raw text, so an assertion can ask whether the element
 * that declares the scroll is also the element that takes the action. Scanned character by
 * character rather than matched with `<[^>]*>`, because `onclick={() => ...}` contains a
 * `>` and that regex ends the tag in the middle of it; tracking `{}` depth is what tells
 * the two apart. A literal `>` inside a quoted attribute value would still cut a tag
 * short, and there is none in this app.
 */
function openingTags(source: string): string[] {
	const tags: string[] = [];
	for (let i = 0; i < source.length; i++) {
		if (source[i] !== '<' || !/[a-zA-Z]/.test(source[i + 1] ?? '')) continue;
		let depth = 0;
		let j = i + 1;
		for (; j < source.length; j++) {
			if (source[j] === '{') depth++;
			else if (source[j] === '}') depth--;
			else if (source[j] === '>' && depth === 0) break;
		}
		tags.push(source.slice(i, j + 1));
		i = j;
	}
	return tags;
}

/** The opening tags in a file that declare a horizontal scroll, each with its element
 * name, since both assertions below need the pair. */
function scrollingTags(source: string): { tag: string; name: string }[] {
	return openingTags(source)
		.filter((tag) => SCROLLS_X.test(tag))
		.map((tag) => ({ tag, name: tag.slice(1).match(/^[a-zA-Z][\w:-]*/)?.[0] ?? '' }));
}

describe('a horizontal scroll container is a containing block (#652)', () => {
	it('finds the app it is walking', () => {
		// A broken walk would make every assertion below pass by finding nothing.
		expect(ALL.length).toBeGreaterThan(200);
		expect(ALL).toContain(TABLE_SCROLL);
	});

	it('finds the containers it is meant to be checking', () => {
		const scrolling = ALL.filter((file) => SCROLLS_X.test(code(file)));
		expect(scrolling).toContain(TABLE_SCROLL);
		expect(scrolling.length).toBeGreaterThanOrEqual(4);
	});

	for (const file of ALL) {
		const lists = scrollingClassLists(code(file));
		if (lists.length === 0) continue;
		it(`${file} positions every element it scrolls horizontally`, () => {
			expect(lists.filter((list) => !CONTAINING_BLOCK.test(list))).toEqual([]);
		});
	}

	it('spells the table scroll container in TableScroll and nowhere else', () => {
		const drawingTables = ALL.filter((file) => /<table[\s>]/.test(code(file)));
		// The four that exist today: the three admin surfaces and the entries table.
		expect(drawingTables.length).toBeGreaterThanOrEqual(4);
		expect(drawingTables.filter((file) => SCROLLS_X.test(code(file)))).toEqual([]);
	});
});

describe('a horizontal scroll container is reachable from a keyboard (#725)', () => {
	it('finds the scrolling elements it is meant to be checking', () => {
		// The same guard against a scanner that silently finds nothing: `openingTags` is
		// hand-written, so a bug in it would turn every assertion below green.
		const found = ALL.flatMap((file) => scrollingTags(code(file)).map((el) => ({ file, ...el })));
		expect(found.length).toBeGreaterThanOrEqual(4);
		expect(found.map((f) => f.file)).toContain(TABLE_SCROLL);
		// And that it reads whole tags: the container's own class list arrives through
		// `cn(...)`, which a `<[^>]*>` match would have truncated.
		expect(found.find((f) => f.file === TABLE_SCROLL)?.tag).toMatch(/data-slot="table-scroll"/);
	});

	it('every exception in the allowlist still exists and still scrolls', () => {
		// An exception for an element that has been renamed or deleted is a hole, not an
		// exception, so it has to keep earning its place.
		for (const { file, tag } of SPANNED_BY_FOCUSABLE_CHILDREN) {
			expect(ALL, `${file} is in the allowlist`).toContain(file);
			expect(
				scrollingTags(code(file)).map((el) => el.name),
				`${file} still scrolls a <${tag}>`
			).toContain(tag);
		}
	});

	for (const file of ALL) {
		const tags = scrollingTags(code(file));
		if (tags.length === 0) continue;
		it(`${file} makes every element it scrolls horizontally focusable`, () => {
			const missing = tags.filter(
				(el) =>
					!KEYBOARD_SCROLLABLE.test(el.tag) &&
					!SPANNED_BY_FOCUSABLE_CHILDREN.some(
						(allowed) => allowed.file === file && allowed.tag === el.name
					)
			);
			expect(missing).toEqual([]);
		});
	}
});
