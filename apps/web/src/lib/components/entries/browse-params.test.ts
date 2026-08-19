// O1 = C (#283). Two contracts here, and both are the difference between a table and a table
// with a decorative footer: a page number means a real window over a counted total, and a
// filter, a sort and a search compose in the URL instead of resetting each other.
import { describe, expect, it } from 'vitest';
import { browseQuery, pageWindow, parseBrowseParams, type BrowseParams } from './browse-params';

function parse(search: string): BrowseParams {
	return parseBrowseParams(new URLSearchParams(search));
}

describe('parseBrowseParams', () => {
	it('defaults to recency, newest first, page one, no filter', () => {
		expect(parse('')).toEqual({
			type: null,
			query: '',
			sort: 'changed',
			direction: 'desc',
			page: 1
		});
	});

	it('reads a filter, a search, a sort, a direction and a page', () => {
		expect(parse('type=place&q=+rat+&sort=relations&dir=asc&page=3')).toEqual({
			type: 'place',
			query: 'rat',
			sort: 'relations',
			direction: 'asc',
			page: 3
		});
	});

	it('ignores anything it does not recognise rather than trusting the URL', () => {
		// 'session' is deliberately not browsable, `body` is not a column, `sideways` is not a
		// direction, and a page below one or not a number is page one.
		expect(parse('type=session&sort=body&dir=sideways&page=0')).toEqual({
			type: null,
			query: '',
			sort: 'changed',
			direction: 'desc',
			page: 1
		});
		expect(parse('page=banana').page).toBe(1);
		expect(parse('page=-4').page).toBe(1);
	});

	it('gives words an a-z default and numbers a biggest-first one', () => {
		expect(parse('sort=name').direction).toBe('asc');
		expect(parse('sort=type').direction).toBe('asc');
		expect(parse('sort=facts').direction).toBe('desc');
		expect(parse('sort=changed').direction).toBe('desc');
	});
});

describe('pageWindow', () => {
	it('divides a total into pages and names the rows on this one', () => {
		expect(pageWindow(214, 1)).toEqual({ pages: 9, page: 1, offset: 0, from: 1, to: 25 });
		expect(pageWindow(214, 4)).toEqual({ pages: 9, page: 4, offset: 75, from: 76, to: 100 });
		// The last page is short, and says so rather than claiming 201-225 of 214.
		expect(pageWindow(214, 9)).toEqual({ pages: 9, page: 9, offset: 200, from: 201, to: 214 });
	});

	it('clamps a page past the end back onto the last real one', () => {
		// The bug this whole module exists to prevent: a footer that says "page 99 of 9" over an
		// empty table, which is what a `?page=99` or a filter that just shrank the result set
		// would otherwise produce.
		expect(pageWindow(214, 99)).toMatchObject({ page: 9, offset: 200 });
		expect(pageWindow(3, 2)).toMatchObject({ pages: 1, page: 1, offset: 0, from: 1, to: 3 });
	});

	it('never says "page 1 of 0" for an empty world', () => {
		expect(pageWindow(0, 1)).toEqual({ pages: 1, page: 1, offset: 0, from: 0, to: 0 });
	});
});

describe('browseQuery', () => {
	const current: BrowseParams = {
		type: 'place',
		query: 'rat',
		sort: 'relations',
		direction: 'asc',
		page: 4
	};

	it('keeps the filter and the search when a header changes the sort', () => {
		expect(browseQuery(current, { sort: 'facts', direction: 'desc', page: 1 })).toBe(
			'?type=place&q=rat&sort=facts'
		);
	});

	it('keeps everything else when the pager changes the page', () => {
		expect(browseQuery(current, { page: 5 })).toBe(
			'?type=place&q=rat&sort=relations&dir=asc&page=5'
		);
	});

	it('omits every parameter the loader would default to anyway', () => {
		expect(
			browseQuery(current, { type: null, query: '', sort: 'changed', direction: 'desc', page: 1 })
		).toBe('');
		// 'asc' is the natural direction for a name, so it is not worth a parameter either.
		expect(
			browseQuery(current, { type: null, query: '', sort: 'name', direction: 'asc', page: 1 })
		).toBe('?sort=name');
	});
});
