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
