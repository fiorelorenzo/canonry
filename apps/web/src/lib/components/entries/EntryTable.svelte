<script lang="ts">
	/**
	 * O1 = C (#283): the browser as a dense table. Name, type, relations, facts, changed;
	 * every column sortable from its own header; numbers in tabular figures, which G2 = C made
	 * an obligation rather than a nicety ("serif figures are proportional, so numeric columns
	 * need tabular figures or they will not align"); a real footer over real pages.
	 *
	 * `j` and `k` move the focused row and Enter opens it, which G3 = B allows: bare keys
	 * inside a focused surface, modifiers everywhere else. The surface here is the entries page,
	 * which is this table and its filter bar and nothing else, so the binding lives on the
	 * window for as long as this component is mounted and gets out of the way in the two cases
	 * where a bare key means something else: a modifier is held (the palette's mod+K, the
	 * browser's own chords), or the GM is typing in a field, since the search box sits directly
	 * above the table.
	 *
	 * There is no selection state to keep in step with anything: a row is a real `<a>` in the
	 * tab order and "the focused row" is the browser's own focus ring, so Enter needs no
	 * handler of its own and a navigation cannot leave a stale highlight behind.
	 *
	 * The hint in the footer is not decoration either: a bare-key shortcut nobody can see is a
	 * shortcut for whoever already knew, which is what C6's own keyboard row is for.
	 *
	 * #367 (Q6) reached this file for colour only, and the rest of the motion pass
	 * deliberately did not. Rows do not stagger in, a page change does not slide, and the
	 * sort arrow does not travel: `j`/`k` walk this table one row at a time and anything
	 * with a duration on it would put itself between the key and the row. The two places
	 * colour now crosses instead of snapping are the row under focus and the header link
	 * under the pointer, both on the fade token, which reduced motion keeps because a
	 * value changing in place is not travel.
	 */
	import { resolve } from '$app/paths';
	import type { EntityBrowserSort } from '@canonry/db';
	import type { EntityType } from '@canonry/db/schema';
	import type { Messages } from '$lib/i18n';
	import { Badge } from '$lib/components/ui/badge';
	import {
		browseQuery,
		defaultDirectionFor,
		type BrowseParams,
		type PageWindow
	} from './browse-params';
	import { relativeTime } from './relative-time';

	interface TableRow {
		id: string;
		name: string;
		type: EntityType;
		slug: string;
		excerpt: string;
		updatedAt: Date;
		relationCount: number;
		factCount: number;
	}

	let {
		universeSlug,
		rows,
		params,
		window: pageWindow,
		matchedCount,
		t,
		filtersT,
		relativeTimeT
	}: {
		universeSlug: string;
		rows: TableRow[];
		params: BrowseParams;
		window: PageWindow;
		matchedCount: number;
		t: Messages['universe']['index']['entries'];
		filtersT: Messages['universe']['index']['filters'];
		relativeTimeT: Messages['universe']['index']['relativeTime'];
	} = $props();

	const base = $derived(resolve(`/w/${universeSlug}/entries`));

	interface Column {
		sort: EntityBrowserSort;
		label: string;
		numeric: boolean;
	}

	const columns = $derived<Column[]>([
		{ sort: 'name', label: t.columnName, numeric: false },
		{ sort: 'type', label: t.columnType, numeric: false },
		{ sort: 'relations', label: t.columnRelations, numeric: true },
		{ sort: 'facts', label: t.columnFacts, numeric: true },
		{ sort: 'changed', label: t.columnChanged, numeric: true }
	]);

	/** Clicking the column already sorted flips it; clicking another starts from whatever
	 * reads naturally for that column (a-z for words, biggest first for numbers and dates),
	 * and always goes back to page 1, since page 4 of one order is nowhere in another. */
	function headerHref(column: Column): string {
		const direction =
			params.sort === column.sort
				? params.direction === 'asc'
					? 'desc'
					: 'asc'
				: defaultDirectionFor(column.sort);
		return `${base}${browseQuery(params, { sort: column.sort, direction, page: 1 })}`;
	}

	let tableEl: HTMLTableElement | undefined = $state();

	function moveFocus(delta: number): void {
		if (!tableEl) return;
		const links = [...tableEl.querySelectorAll<HTMLAnchorElement>('a[data-row-link]')];
		if (links.length === 0) return;
		const active = document.activeElement;
		const current = links.findIndex((link) => link === active);
		// Nothing focused yet (the GM pressed `j` having just clicked into the table's own
		// area): start at the first row rather than doing nothing, which is what makes the
		// hint in the footer true on the first press.
		const next = current === -1 ? 0 : Math.min(Math.max(current + delta, 0), links.length - 1);
		links[next]?.focus();
	}

	function onKeydown(event: KeyboardEvent): void {
		// A modifier means the key belongs to the browser, the OS or the palette (mod+K), and a
		// text field means the GM is typing - the search box sits directly above this table.
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const target = event.target as HTMLElement | null;
		if (
			target?.tagName === 'INPUT' ||
			target?.tagName === 'TEXTAREA' ||
			target?.isContentEditable
		) {
			return;
		}
		if (event.key === 'j') {
			event.preventDefault();
			moveFocus(1);
		} else if (event.key === 'k') {
			event.preventDefault();
			moveFocus(-1);
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<!-- eslint-disable svelte/no-navigation-without-resolve -- every href below is a resolve()
     result with a query string appended, which the rule cannot see through. -->
<div class="mt-4 overflow-x-auto rounded-lg border border-line">
	<table bind:this={tableEl} class="w-full border-collapse text-sm" aria-label={t.tableAriaLabel}>
		<thead>
			<tr class="border-b border-line-2 bg-panel-2">
				{#each columns as column (column.sort)}
					{@const active = params.sort === column.sort}
					<th
						scope="col"
						class="px-3 py-2 text-xs font-semibold tracking-wide text-muted uppercase"
						class:text-right={column.numeric}
						class:text-left={!column.numeric}
						aria-sort={active ? (params.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
					>
						<a
							href={headerHref(column)}
							class="inline-flex items-center gap-1 transition-colors hover:text-ink"
							class:text-ink={active}
							title={t.sortBy(column.label)}
						>
							{column.label}
							{#if active}
								<span aria-hidden="true">{params.direction === 'asc' ? '▴' : '▾'}</span>
							{/if}
						</a>
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as row (row.id)}
				<tr
					class="border-b border-line transition-colors last:border-b-0 focus-within:bg-accent-bg"
				>
					<td class="max-w-measure px-3 py-2">
						<a
							data-row-link
							href={resolve(`/w/${universeSlug}/e/${row.slug}`)}
							class="font-medium text-ink underline decoration-line-2 decoration-1 underline-offset-2 transition-colors hover:text-accent"
						>
							{row.name}
						</a>
					</td>
					<td class="px-3 py-2">
						<Badge variant="secondary" class="font-mono uppercase">
							{filtersT.typeLabel(row.type)}
						</Badge>
					</td>
					<td class="px-3 py-2 text-right text-ink-2 tabular-nums">{row.relationCount}</td>
					<td class="px-3 py-2 text-right text-ink-2 tabular-nums">{row.factCount}</td>
					<td class="px-3 py-2 text-right text-nowrap text-muted tabular-nums">
						{relativeTime(row.updatedAt, relativeTimeT)}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
	<span class="flex items-center gap-1.5">
		<kbd class="rounded border border-line-2 bg-panel-2 px-1 font-mono">j</kbd>
		<kbd class="rounded border border-line-2 bg-panel-2 px-1 font-mono">k</kbd>
		{t.moveHint}
	</span>
	<span class="flex items-center gap-1.5">
		<kbd class="rounded border border-line-2 bg-panel-2 px-1 font-mono">&crarr;</kbd>
		{t.openHint}
	</span>
	<span class="ml-auto tabular-nums">
		{t.range(pageWindow.from, pageWindow.to, matchedCount)} &middot; {t.pageOf(
			pageWindow.page,
			pageWindow.pages
		)}
	</span>
	<span class="flex items-center gap-2">
		{#if pageWindow.page > 1}
			<a
				href={`${base}${browseQuery(params, { page: pageWindow.page - 1 })}`}
				class="rounded-md border border-line-2 px-2 py-1 font-medium text-ink-2 hover:text-ink"
			>
				{t.previousPage}
			</a>
		{/if}
		{#if pageWindow.page < pageWindow.pages}
			<a
				href={`${base}${browseQuery(params, { page: pageWindow.page + 1 })}`}
				class="rounded-md border border-line-2 px-2 py-1 font-medium text-ink-2 hover:text-ink"
			>
				{t.nextPage}
			</a>
		{/if}
	</span>
</div>
<!-- eslint-enable svelte/no-navigation-without-resolve -->
