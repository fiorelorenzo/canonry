<script lang="ts">
	/**
	 * Issue #149 (A3 = C, "one box that routes to the surface that fits"; G3 = B,
	 * cross-platform shortcuts). Mounted once by AppShell for every signed-in,
	 * non-public-wiki route, so mod+K opens it identically from a universe route or an
	 * account-mode route (#104's own lock-in). `paletteState` (palette-state.svelte.ts)
	 * is the open flag: any component - this one, the phone top bar's trigger icon -
	 * can flip it without AppShell threading a prop through every intermediate layer.
	 *
	 * Three result kinds, exactly A3 = C's decision: jump to an entry (server side
	 * name/alias search only, `palette-search/+server.ts` - never the fast/vector lane,
	 * out of scope for this issue), run an action (nav destinations, New entry, New
	 * universe, the settings panes - `actions.ts`), and a typed question, which routes
	 * to Ask rather than answering inline (C8, G5) - `question.ts`'s classifier decides
	 * whether that row shows, and the matching entity still renders underneath it, "in
	 * case a name was meant" (A3's own mock).
	 *
	 * Issue #285 (decision O3) grows the second placement this component was always
	 * going to need: `placement="docked"` renders the same `Command.Root` and the same
	 * `Command.Input` inline, with no dialog around it, which is what the floating
	 * Loremaster panel mounts. One input implementation in two positions rather than a
	 * second composer beside this one. Five differences, all of them because a docked
	 * copilot composer is not a command runner:
	 *
	 * - The Ask row is not gated on `looksLikeQuestion`. In the palette that gate keeps
	 *   a typed name from looking like a question; in the panel everything typed is a
	 *   question, and a composer whose Enter key sometimes does nothing is broken.
	 * - It calls `onAsk` instead of linking to the route, because O3's whole point is
	 *   that the answer arrives without leaving the page. Entry rows stay real links
	 *   and `onNavigate` lets the panel close behind them.
	 * - Actions, the account-mode universe list and the keyboard footer stay out. mod+K
	 *   is still the command runner; the panel has its own two exits.
	 * - `query` is a bindable prop rather than pure internal state (#381, R6): the
	 *   panel's suggestion chips fill it from outside without sending it. Unbound, as
	 *   the dialog placement leaves it, it behaves exactly like the local `$state` it
	 *   replaced.
	 * - Results render above the input, not below (#381, R6): the panel now pins this
	 *   composer to its own bottom edge, so a dropdown opening downward would have
	 *   nowhere to go.
	 *
	 * Every row is a real `Command.LinkItem` (a real `<a href>`), not an `onSelect`-only
	 * click handler - the same mod/ctrl-click-opens-a-tab behaviour a GM expects from
	 * any link keeps working here, and Enter on the focused row works by the primitive
	 * calling the anchor's own `.click()`, not a hand-written navigation. Escape closes
	 * through bits-ui's own escape-layer (Dialog's default) and ↑/↓/Enter are Command's
	 * own roving selection - none of that is `lib/keys.ts` vocabulary, which is
	 * reserved for the chords that have to agree with a platform's modifier map
	 * (mod+K, mod+shift+A), not plain list navigation.
	 *
	 * mod+shift+A used to be handled here, sending the GM to the Ask route. It moved to
	 * `QuickAsk.svelte` with #285: the pill prints that chord, so the chord has to open
	 * the pill, and binding it in the component that draws it means it is simply not
	 * bound on the one surface where the pill hides (table mode) rather than opening a
	 * panel nobody can see.
	 */
	import { resolve } from '$app/paths';
	import * as Command from '$lib/components/ui/command';
	import { Badge } from '$lib/components/ui/badge';
	import { messages, type Locale } from '$lib/i18n';
	import { matchesShortcut, SHORTCUTS } from '$lib/keys';
	import type { EntitySearchHit } from '@canonry/db';
	import type { UniverseSummary } from '$lib/components/shell/types';
	import { filterActions, paletteActions } from './actions';
	import { looksLikeQuestion } from './question';
	import { paletteState } from './palette-state.svelte';

	let {
		mode,
		universeSlug,
		universes,
		locale,
		placement = 'dialog',
		query = $bindable(''),
		inputEl = $bindable<HTMLInputElement | null>(null),
		onAsk,
		onNavigate
	}: {
		mode: 'universe' | 'account';
		universeSlug: string | null;
		universes: UniverseSummary[];
		locale: Locale;
		/** 'dialog' (default): A3's own overlay, opened by mod+K. 'docked': #285's
		 * floating panel, which mounts this same input inline. */
		placement?: 'dialog' | 'docked';
		/** Docked only, bindable: #381's suggestion chips fill this from outside without
		 * sending it, the one thing plain internal state could not do. Unbound (the
		 * dialog placement) it behaves exactly as the local `$state` it replaces. */
		query?: string;
		/** Docked only, bindable: the input's own node, so the panel that mounts this can
		 * put the caret back after filling `query` from outside. A chip that fills the box
		 * without moving focus leaves the text somewhere nobody is typing. */
		inputEl?: HTMLInputElement | null;
		/** Docked only: the panel answers in place instead of routing. */
		onAsk?: (question: string) => void;
		/** Docked only: a row navigated away, so whatever mounted this can close. */
		onNavigate?: () => void;
	} = $props();

	const t = $derived(messages(locale).shell.palette);
	const docked = $derived(placement === 'docked');

	// Non-null: this id is an entry the shortcut vocabulary in keys.ts carries - see that
	// file's SHORTCUTS table.
	const paletteShortcut = SHORTCUTS.find((shortcut) => shortcut.id === 'palette')!;

	/** Docked only: the dialog placement gets its focus from the dialog itself, and a
	 * panel that expands without the caret in the box is a panel you have to click twice.
	 * Bindable above, so the panel can also focus it after a suggestion chip. */
	let entityHits = $state<EntitySearchHit[]>([]);
	let searching = $state(false);
	let requestSeq = 0;
	/** Docked only: the question already sent, so the suggestion list gets out of the
	 * answer's way until the GM edits the box again. */
	let askedQuery = $state<string | null>(null);

	const trimmedQuery = $derived(query.trim());
	const isQuestion = $derived(looksLikeQuestion(query));
	const actions = $derived(filterActions(paletteActions(mode, universeSlug, locale), query));
	const askHref = $derived(
		universeSlug
			? `${resolve(`/w/${universeSlug}/ask`)}?q=${encodeURIComponent(trimmedQuery)}`
			: null
	);
	const showResults = $derived(
		docked ? trimmedQuery.length > 0 && trimmedQuery !== askedQuery : true
	);
	const filteredUniverses = $derived.by(() => {
		if (mode !== 'account') return [];
		const q = trimmedQuery.toLowerCase();
		if (!q) return universes;
		return universes.filter((universe) => universe.name.toLowerCase().includes(q));
	});

	async function runEntitySearch(slug: string, q: string) {
		const seq = ++requestSeq;
		if (q.length === 0) {
			entityHits = [];
			searching = false;
			return;
		}
		searching = true;
		const response = await fetch(`/w/${slug}/palette-search?q=${encodeURIComponent(q)}`);
		if (seq !== requestSeq) return; // a later keystroke's response already landed
		searching = false;
		if (!response.ok) {
			entityHits = [];
			return;
		}
		const body = (await response.json()) as { hits: EntitySearchHit[] };
		entityHits = body.hits;
	}

	let debounceHandle: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const slug = universeSlug;
		const q = trimmedQuery;
		// Docked, with the list folded away behind an answer, there is nothing to search
		// for: the hits would be fetched and never drawn.
		if (!slug || !showResults) {
			entityHits = [];
			return;
		}
		clearTimeout(debounceHandle);
		debounceHandle = setTimeout(() => runEntitySearch(slug, q), 120);
	});

	// Reopening starts from a blank box rather than showing whatever the last search
	// left behind - the same reasoning `InstantSearch.svelte`'s own `requestSeq` guard
	// applies to a single stale response, extended here to a whole closed-then-reopened
	// session. The docked placement needs no equivalent: it is only mounted while the
	// panel is open, so it starts blank by being created.
	$effect(() => {
		if (docked || paletteState.open) return;
		query = '';
		entityHits = [];
		searching = false;
		requestSeq += 1;
	});

	$effect(() => {
		if (docked) inputEl?.focus();
	});

	function closePalette() {
		paletteState.open = false;
	}

	function rowSelected() {
		if (docked) onNavigate?.();
		else closePalette();
	}

	function ask() {
		if (trimmedQuery.length === 0) return;
		askedQuery = trimmedQuery;
		onAsk?.(trimmedQuery);
	}

	function onWindowKeydown(event: KeyboardEvent) {
		if (docked) return; // one binding per chord, and the dialog placement owns mod+K
		if (matchesShortcut(event, paletteShortcut)) {
			event.preventDefault();
			paletteState.open = !paletteState.open;
		}
	}

	// Enter with the suggestion list folded away has no highlighted row for Command to
	// select, so re-asking the same question would silently do nothing.
	function onDockedKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' || showResults) return;
		event.preventDefault();
		ask();
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#snippet input()}
	<Command.Input
		bind:value={query}
		bind:ref={inputEl}
		placeholder={docked ? t.askPlaceholder : t.placeholder}
	/>
{/snippet}

{#snippet results()}
	{#if mode === 'universe' && universeSlug}
		{#if docked}
			{#if trimmedQuery.length > 0}
				<Command.Group heading={t.askHeading}>
					<Command.Item onSelect={ask} class="text-ink">
						<span aria-hidden="true">✦</span>
						<span class="min-w-0 truncate">{t.askAction(trimmedQuery)}</span>
						<Command.Shortcut>{t.askHereHint}</Command.Shortcut>
					</Command.Item>
				</Command.Group>
			{/if}
		{:else if isQuestion && askHref}
			<Command.Group heading={t.askHeading}>
				<Command.LinkItem href={askHref} onSelect={rowSelected} class="text-ai">
					<span aria-hidden="true">✦</span>
					<span class="min-w-0 truncate">{t.askAction(trimmedQuery)}</span>
					<Command.Shortcut>{t.askHint}</Command.Shortcut>
				</Command.LinkItem>
			</Command.Group>
		{/if}

		{#if trimmedQuery.length > 0}
			<Command.Group heading={t.entriesHeading}>
				{#if searching}
					<Command.Loading>{t.loadingMessage}</Command.Loading>
				{:else if entityHits.length === 0}
					<p class="px-2 py-3 text-sm text-muted">{t.noEntryMatches(trimmedQuery)}</p>
				{:else}
					{#each entityHits as hit (hit.id)}
						<Command.LinkItem
							href={resolve(`/w/${universeSlug}/e/${hit.slug}`)}
							onSelect={rowSelected}
						>
							<span class="min-w-0 truncate">{hit.name}</span>
							{#if hit.matchedAlias}
								<span class="shrink-0 text-xs text-muted">{t.akaHint(hit.matchedAlias)}</span>
							{/if}
							<Badge variant="secondary" class="ml-auto shrink-0 font-mono uppercase">
								{messages(locale).universe.index.filters.typeLabel(hit.type)}
							</Badge>
						</Command.LinkItem>
					{/each}
				{/if}
			</Command.Group>
		{/if}
	{/if}

	{#if !docked}
		{#if mode === 'account'}
			<Command.Group heading={t.universesHeading}>
				{#if filteredUniverses.length === 0}
					<p class="px-2 py-3 text-sm text-muted">{t.noUniverseMatches(trimmedQuery)}</p>
				{:else}
					{#each filteredUniverses as universe (universe.id)}
						<Command.LinkItem href={resolve(`/w/${universe.slug}`)} onSelect={rowSelected}>
							<span class="min-w-0 truncate">{universe.name}</span>
						</Command.LinkItem>
					{/each}
				{/if}
			</Command.Group>
		{/if}

		{#if actions.length > 0}
			<Command.Group heading={t.actionsHeading}>
				{#each actions as action (action.id)}
					<Command.LinkItem href={action.href} onSelect={rowSelected}>
						<span class="min-w-0 truncate">{action.label}</span>
					</Command.LinkItem>
				{/each}
			</Command.Group>
		{/if}

		<Command.Empty>{t.emptyMessage}</Command.Empty>
	{/if}
{/snippet}

{#if docked}
	<!-- No dialog, no overlay, no footer: the panel around this owns its own chrome, and
	     wears the theme's colours rather than the copilot's own hue (O3's amendment).
	     #381 (R6): results render above the input rather than below it, the one
	     difference from the dialog placement's order - the docked composer is pinned to
	     the bottom of the conversation panel now, so a dropdown that opened downward
	     would have nowhere to go.
	     `Command.List` itself stays mounted regardless of `showResults` - only its
	     contents are conditional - because bits-ui's `Command.Input` reads its
	     `aria-controls` off the mounted list's id (axe: "Required ARIA attribute not
	     present" the moment the list unmounts). An empty `Command.List` has no padding
	     of its own, so this changes nothing visible: a childless list still collapses to
	     zero height exactly as the old conditional wrapper did. -->
	<Command.Root shouldFilter={false} onkeydown={onDockedKeydown} class="bg-transparent p-0">
		<Command.List class="max-h-56">
			{#if showResults}
				{@render results()}
			{/if}
		</Command.List>
		{@render input()}
	</Command.Root>
{:else}
	<Command.Dialog
		bind:open={paletteState.open}
		title={t.dialogTitle}
		description={t.dialogDescription}
		closeLabel={t.closeLabel}
		shouldFilter={false}
	>
		{@render input()}
		<Command.List>
			{@render results()}
		</Command.List>
		<div class="flex gap-3 border-t border-line bg-panel-2 px-3 py-1.5 text-xs text-muted">
			<span>↑↓ {t.footerMove}</span>
			<span>↵ {t.footerOpen}</span>
			<span>Esc {t.footerClose}</span>
		</div>
	</Command.Dialog>
{/if}
