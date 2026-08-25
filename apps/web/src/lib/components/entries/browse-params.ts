/**
 * O1 = C (#283): what the entry table reads out of its own URL, and the page arithmetic its
 * footer prints. Pure, and tested next door, because this is where the bug the decision names
 * actually lived: the page it replaces took up to 500 rows with no pages behind it, and a
 * footer that says "page 1 of 3" over a query with no pages is a lie in the footer.
 *
 * Everything is in the query string rather than in a cookie or in component state, so a
 * filtered, sorted, paged view is bookmarkable and survives the back button - the same
 * reasoning `TypeFilterRow` already uses for `?type=`.
 */
import type { EntityBrowserSort } from '@canonry/db';
import type { EntityType } from '@canonry/db/schema';

/** Five browsable types, deliberately not six: `session` has no create path in the product,
 * so it earns no chip. It still shows under "All" and through search. */
export const BROWSABLE_TYPES: EntityType[] = ['character', 'place', 'faction', 'event', 'item'];

/** Exactly the five columns the table draws, and the only orders it can be in. */
const SORTS: EntityBrowserSort[] = ['name', 'type', 'relations', 'facts', 'changed'];

/** One screenful of a dense table, and small enough that a world of a few hundred entries
 * genuinely has pages rather than one page with a paginator drawn on it for show. */
export const PAGE_SIZE = 25;

export interface BrowseParams {
	type: EntityType | null;
	query: string;
	sort: EntityBrowserSort;
	direction: 'asc' | 'desc';
	/** 1-based, as the footer says it. Never below 1; the upper bound needs the total, so
	 * the loader clamps that after counting. */
	page: number;
}

export function isBrowsableType(value: string | null | undefined): value is EntityType {
	return typeof value === 'string' && (BROWSABLE_TYPES as string[]).includes(value);
}

/** Recency first: what a GM most often wants is what they just touched, and it is the order
 * the flat list this replaces already had. Exported so a plain GET form (the search box in
 * `+page.svelte`) can omit its own hidden `sort`/`dir` fields against the same default
 * `browseQuery` below omits them against, rather than a second copy of 'changed' drifting
 * out of step with it. */
export const DEFAULT_SORT: EntityBrowserSort = 'changed';

/** Names read a-z, numbers and dates read biggest-first, which is what each column is for. */
export function defaultDirectionFor(sort: EntityBrowserSort): 'asc' | 'desc' {
	return sort === 'name' || sort === 'type' ? 'asc' : 'desc';
}

/** The direction the *header link* points at: clicking the column already sorted flips it,
 * clicking any other starts from that column's natural order. This is the action, and it is
 * deliberately a different function from `ariaSortFor` below, because the two answers are
 * opposites on the sorted column and conflating them is the defect #750 was filed for. */
export function nextDirectionFor(current: BrowseParams, column: EntityBrowserSort): 'asc' | 'desc' {
	if (current.sort !== column) return defaultDirectionFor(column);
	return current.direction === 'asc' ? 'desc' : 'asc';
}

/**
 * What `aria-sort` says on a column header (#750): the order the table **is in**, which is
 * the fact a screen reader announces, and never the order clicking would produce. "Sort by
 * Name" and "currently sorted by name, ascending" are two different sentences, and the
 * header carries both: the link's description is the action, this attribute is the state.
 * Reusing `nextDirectionFor` here would announce `descending` on a table sorted ascending.
 *
 * Nothing rather than `none` on the other four columns, and that is measured rather than
 * preferred. I wrote `none` first, on the reasoning that it tells a reader the other four
 * are sortable candidates rather than dead headings, and the AT-SPI2 tree says it does not:
 * Chrome maps `aria-sort="none"` to no `sort` object attribute at all, because `none` is the
 * property's default, so `none` and absent are byte-identical to a Linux screen reader.
 * With that channel empty either way, what is left argues for absent. Sortability is already
 * carried per header by the link inside it, whose description is "Sort by <column>", so
 * `none` could at best duplicate that; and on a platform that does surface the default it
 * would spend an announcement on four of five headers to say "not sorted", which is the row
 * order the reader is about to hear anyway. An attribute whose only reachable effect is
 * redundancy is not worth spelling.
 */
export function ariaSortFor(
	current: BrowseParams,
	column: EntityBrowserSort
): 'ascending' | 'descending' | undefined {
	if (current.sort !== column) return undefined;
	return current.direction === 'asc' ? 'ascending' : 'descending';
}

export function parseBrowseParams(params: URLSearchParams): BrowseParams {
	const typeParam = params.get('type');
	const sortParam = params.get('sort');
	const sort = SORTS.find((candidate) => candidate === sortParam) ?? DEFAULT_SORT;
	const dirParam = params.get('dir');
	const pageParam = Number.parseInt(params.get('page') ?? '', 10);
	return {
		type: isBrowsableType(typeParam) ? typeParam : null,
		query: params.get('q')?.trim() ?? '',
		sort,
		direction: dirParam === 'asc' || dirParam === 'desc' ? dirParam : defaultDirectionFor(sort),
		page: Number.isFinite(pageParam) && pageParam > 1 ? pageParam : 1
	};
}

export interface PageWindow {
	/** At least 1 even for an empty world, so the footer never says "page 1 of 0". */
	pages: number;
	page: number;
	offset: number;
	/** 1-based, inclusive, for "1-25 of 214". Both 0 when there is nothing to show. */
	from: number;
	to: number;
}

/** The window a page number means over a counted total, with the page clamped into range:
 * a `?page=99` typed into the URL, or left behind by a filter that just shrank the result
 * set, lands on the last real page instead of on an empty table under a footer claiming
 * otherwise. */
export function pageWindow(total: number, page: number, pageSize = PAGE_SIZE): PageWindow {
	const pages = Math.max(1, Math.ceil(total / pageSize));
	const clamped = Math.min(Math.max(1, page), pages);
	const offset = (clamped - 1) * pageSize;
	return {
		pages,
		page: clamped,
		offset,
		from: total === 0 ? 0 : offset + 1,
		to: Math.min(total, offset + pageSize)
	};
}

/** The query string for one variation on the current view. A column header passes a sort, a
 * pager passes a page, and both keep whatever filter and search are already active - which is
 * what "filter chips and a query string still compose" means in practice. */
export function browseQuery(
	current: BrowseParams,
	changes: Partial<Pick<BrowseParams, 'sort' | 'direction' | 'page' | 'type' | 'query'>>
): string {
	const next = { ...current, ...changes };
	const params = new URLSearchParams();
	if (next.type) params.set('type', next.type);
	if (next.query) params.set('q', next.query);
	// Only when it differs from what the loader would pick anyway, so the common URL stays
	// `/entries` rather than `/entries?sort=changed&dir=desc&page=1`.
	if (next.sort !== DEFAULT_SORT) params.set('sort', next.sort);
	if (next.direction !== defaultDirectionFor(next.sort)) params.set('dir', next.direction);
	if (next.page > 1) params.set('page', String(next.page));
	const qs = params.toString();
	return qs ? `?${qs}` : '';
}
