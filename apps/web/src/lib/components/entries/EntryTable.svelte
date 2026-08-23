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
	 * #367 (Q6) reached this file for colour only at first: rows staying still while
	 * `j`/`k` walked them one at a time, a page change that does not slide, a sort arrow
	 * that does not travel. V9 (round seventeen, #501) widens that: the entries table is
	 * named as a working surface a list may cascade onto (docs/ux/MOTION.md, "a list
	 * arriving"), so each page of rows now fades in once, roughly 40ms apart, capped past
	 * the eleventh row so a full 25-row page still finishes inside half a second. Opacity
	 * only, never a slide: a translate on a `display: table-row` element does not paint
	 * consistently across engines, and it stays true that nothing here delays `j`/`k` -
	 * a row is a real, focusable `<a>` the instant it exists, whatever its own fade is
	 * still doing. The row-under-focus and header-link-under-pointer colour crossings
	 * from #367 are unchanged, both on the fade token.
	 */
	import { resolve } from '$app/paths';
	import type { EntityBrowserSort } from '@canonry/db';
	import type { EntityType } from '@canonry/db/schema';
	import type { Messages } from '$lib/i18n';
	import { Badge } from '$lib/components/ui/badge';
	import { cn } from '$lib/utils/cn.js';
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
		/** #524: relations and facts are comparison columns with nothing to compare on a
		 * phone - they are also the two columns a real seeded world shows as 0 or 1 on
		 * almost every row, so a phone spent nearly half its width on non-information.
		 * Hidden below `sm`, `table-cell` again at `sm` and up, where O1's dense table
		 * keeps exactly the shape round seventeen's V1 settled. */
		phoneHidden?: boolean;
		/** A fixed mobile column width. Only meaningful below `sm`, where the table
		 * switches to `table-layout: fixed` so the name column gets a definite box to
		 * truncate against instead of an unbounded one that forces the row wider than
		 * the screen - `sm:w-auto` gives the width back to auto layout at `sm` and up,
		 * unchanged from what round seventeen shipped. */
		phoneWidth?: string;
	}

	const columns = $derived<Column[]>([
		{ sort: 'name', label: t.columnName, numeric: false },
		{ sort: 'type', label: t.columnType, numeric: false, phoneWidth: 'w-32' },
		{ sort: 'relations', label: t.columnRelations, numeric: true, phoneHidden: true },
		{ sort: 'facts', label: t.columnFacts, numeric: true, phoneHidden: true },
		{ sort: 'changed', label: t.columnChanged, numeric: true, phoneWidth: 'w-28' }
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
	<table
		bind:this={tableEl}
		class="w-full table-fixed border-collapse text-sm sm:table-auto"
		aria-label={t.tableAriaLabel}
	>
		<thead>
			<tr class="border-b border-line-2 bg-panel-2">
				{#each columns as column (column.sort)}
					{@const active = params.sort === column.sort}
					<th
						scope="col"
						class={cn(
							'px-2 py-2 text-label font-semibold tracking-wide text-muted uppercase sm:px-3',
							column.numeric ? 'text-right' : 'text-left',
							column.phoneWidth && `${column.phoneWidth} sm:w-auto`,
							column.phoneHidden && 'hidden sm:table-cell'
						)}
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
			{#each rows as row, i (row.id)}
				<tr
					class="motion-row-arrive border-b border-line transition-colors last:border-b-0 focus-within:bg-accent-bg"
					style={`animation-delay: ${Math.min(i, 11) * 40}ms`}
				>
					<td class="max-w-measure px-2 py-2 align-middle sm:px-3">
						<a
							data-row-link
							href={resolve(`/w/${universeSlug}/e/${row.slug}`)}
							title={row.name}
							class="block min-h-11 truncate py-3 font-medium text-ink underline decoration-line-2 decoration-1 underline-offset-2 transition-colors hover:text-accent sm:inline sm:min-h-0 sm:overflow-visible sm:py-0 sm:whitespace-normal"
						>
							{row.name}
						</a>
					</td>
					<td class="w-32 px-2 py-2 align-middle sm:w-auto sm:px-3">
						<Badge variant="secondary" class="font-mono uppercase">
							{filtersT.typeLabel(row.type)}
						</Badge>
					</td>
					<td
						class="hidden px-3 py-2 text-right align-middle text-ink-2 tabular-nums sm:table-cell"
					>
						{row.relationCount}
					</td>
					<td
						class="hidden px-3 py-2 text-right align-middle text-ink-2 tabular-nums sm:table-cell"
					>
						{row.factCount}
					</td>
					<td
						class="w-28 px-2 py-2 text-right align-middle text-nowrap text-muted tabular-nums sm:w-auto sm:px-3"
					>
						{relativeTime(row.updatedAt, relativeTimeT)}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-meta text-muted">
	<!-- Issue #148: bare `j`/`k`/`↵` hints name keys a phone does not have. Every other
	     surface with a keyboard hint (CommandPalette, ProposalQueue, InlineProposalReview)
	     already hides its own behind the shared `KeyHint` component's `sm:flex` default -
	     this footer hand-rolled the same two spans and never got the same treatment. -->
	<div class="hidden items-center gap-4 sm:flex">
		<span class="flex items-center gap-1.5">
			<kbd class="rounded border border-line-2 bg-panel-2 px-1 font-mono">j</kbd>
			<kbd class="rounded border border-line-2 bg-panel-2 px-1 font-mono">k</kbd>
			{t.moveHint}
		</span>
		<span class="flex items-center gap-1.5">
			<kbd class="rounded border border-line-2 bg-panel-2 px-1 font-mono">&crarr;</kbd>
			{t.openHint}
		</span>
	</div>
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
				class="flex min-h-11 items-center rounded-md border border-line-2 px-2 py-1 font-medium text-ink-2 hover:text-ink sm:min-h-0"
			>
				{t.previousPage}
			</a>
		{/if}
		{#if pageWindow.page < pageWindow.pages}
			<a
				href={`${base}${browseQuery(params, { page: pageWindow.page + 1 })}`}
				class="flex min-h-11 items-center rounded-md border border-line-2 px-2 py-1 font-medium text-ink-2 hover:text-ink sm:min-h-0"
			>
				{t.nextPage}
			</a>
		{/if}
	</span>
</div>

<!-- eslint-enable svelte/no-navigation-without-resolve -->

<style>
	/* V9 (round seventeen, #501, docs/ux/MOTION.md "a list arriving"): each row of a
	   freshly mounted page fades in once, in order. Keyed by `row.id`, so a sort or a
	   page change - a new set of ids - remounts every row and replays this; nothing
	   about j/k moving the browser's own focus touches these nodes, so it never
	   replays on that. `both` keeps a row at its resting opacity once its own
	   animation ends rather than snapping back to the keyframe's 0% on the next
	   paint. duration-fade is the only token this earns: a translate on a
	   `display: table-row` element does not paint the same in every engine, so the
	   cascade is opacity-only, which is also why it stays running rather than
	   collapsing under reduced motion (Q6: a value changing in place is not travel). */
	tr.motion-row-arrive {
		animation: motion-row-arrive var(--transition-duration-fade) var(--ease-arrive) both;
	}

	@keyframes motion-row-arrive {
		from {
			opacity: 0;
		}
	}
</style>
