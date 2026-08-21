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
	 * second composer beside this one. Six differences, all of them because a docked
	 * copilot composer is not a command runner:
	 *
	 * - No ask row, and Enter always sends (#416, S11, reversing #285's own first cut).
	 *   `onDockedKeydown` intercepts Enter unconditionally now rather than only when the
	 *   entry list is empty, because a composer whose Enter key sometimes selects a link
	 *   instead of sending the question is not a composer.
	 * - No empty-entry state, and entries render only when there is at least one match
	 *   (#416, S11): "no entries match that sentence" was never true of a question,
	 *   because a question was never a name. The chrome changes with it: no leading
	 *   search icon, a trailing send button, and the input group's own paper and line
	 *   colours rather than the translucent input/ring pair the dialog placement keeps.
	 * - It calls `onAsk` instead of linking to the route, because O3's whole point is
	 *   that the answer arrives without leaving the page. Entry rows stay real links;
	 *   `onNavigate` is the caller's own choice, and QuickAsk does not pass it (R5), so a
	 *   row navigates like any other link and the panel stays open behind it.
	 * - Actions, the account-mode universe list and the keyboard footer stay out. mod+K
	 *   is still the command runner; the panel has its own two exits.
	 * - `query` is a bindable prop rather than pure internal state (#381, R6), and stays
	 *   that way after #413 stopped a suggestion chip writing it: QuickAsk still needs to
	 *   clear the box once a turn it started has actually been asked, and only the caller
	 *   knows when that is. Unbound, as the dialog placement leaves it, it behaves
	 *   exactly like the local `$state` it replaced.
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
	import SendIcon from '@lucide/svelte/icons/send';
	import * as Command from '$lib/components/ui/command';
	import { Badge } from '$lib/components/ui/badge';
	import { KeyHint, type KeyHintPair } from '$lib/components/ui/key-hint';
	import * as InputGroup from '$lib/components/ui/input-group';
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
		/** Docked only, bindable: the panel that mounts this clears the box once the
		 * question it holds has actually been asked (`ask()` below reads `query`,
		 * QuickAsk's own `ask()` then empties it) - the one thing plain internal state
		 * could not do. #413 stopped a suggestion chip being what writes it; the
		 * composer's own Enter and send control are what write it now, exactly as
		 * before. Unbound (the dialog placement) it behaves exactly as the local
		 * `$state` it replaces. */
		query?: string;
		/** Docked only: the panel answers in place instead of routing. */
		onAsk?: (question: string) => void;
		/** Docked only: a row navigated away, so whatever mounted this can close. */
		onNavigate?: () => void;
	} = $props();

	const t = $derived(messages(locale).shell.palette);
	const docked = $derived(placement === 'docked');

	// T5 (round fifteen), issue #432: the dialog footer's own three pairs, in the shared
	// `KeyHint` shape rather than plain text with no `kbd` at all.
	const footerPairs = $derived<KeyHintPair[]>([
		{ key: '\u2191\u2193', label: t.footerMove },
		{ key: '\u21b5', label: t.footerOpen },
		{ key: 'Esc', label: t.footerClose }
	]);

	// Non-null: this id is an entry the shortcut vocabulary in keys.ts carries - see that
	// file's SHORTCUTS table.
	const paletteShortcut = SHORTCUTS.find((shortcut) => shortcut.id === 'palette')!;

	/** Docked only: the dialog placement gets its focus from the dialog itself, and a
	 * panel that expands without the caret in the box is a panel you have to click
	 * twice. Local rather than bindable (#416, S11): nothing outside this component
	 * moves focus into it any more now that a suggestion chip asks instead of filling
	 * the box (#413). */
	let inputEl = $state<HTMLInputElement | null>(null);
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

	// The composer's Enter always sends (#416, S11): there is no ask row left to
	// highlight, and letting Command's own combobox handling run instead would select
	// whichever entry row happens to be first rather than asking the typed question.
	// `preventDefault` here reaches that internal handling too - `composeHandlers`
	// (svelte-toolbelt, underneath bits-ui's `Command.Root`) stops at the first handler
	// that has already prevented the default, and this one runs first.
	function onDockedKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter') return;
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
		showSearchIcon={!docked}
		groupClass={docked ? 'rounded-lg! border-line-2 bg-panel shadow-none!' : undefined}
		trailing={docked ? sendControl : undefined}
	/>
{/snippet}

{#snippet sendControl()}
	<InputGroup.Button
		type="button"
		size="icon-xs"
		aria-label={t.sendLabel}
		title={t.sendLabel}
		disabled={trimmedQuery.length === 0}
		onclick={ask}
	>
		<SendIcon aria-hidden="true" />
	</InputGroup.Button>
{/snippet}

{#snippet results()}
	{#if mode === 'universe' && universeSlug}
		{#snippet entryRow(hit: EntitySearchHit)}
			<Command.LinkItem href={resolve(`/w/${universeSlug}/e/${hit.slug}`)} onSelect={rowSelected}>
				<span class="min-w-0 truncate">{hit.name}</span>
				{#if hit.matchedAlias}
					<span class="shrink-0 text-xs text-muted">{t.akaHint(hit.matchedAlias)}</span>
				{/if}
				<Badge variant="secondary" class="ml-auto shrink-0 font-mono uppercase">
					{messages(locale).universe.index.filters.typeLabel(hit.type)}
				</Badge>
			</Command.LinkItem>
		{/snippet}

		{#if docked}
			<!-- #416, S11: no ask row (Enter and the send control beside the input do
			     that job) and no empty-entry state - "no entries match that sentence"
			     was never true of a question, because a question was never a name. -->
			{#if trimmedQuery.length > 0}
				{#if searching}
					<Command.Group heading={t.entriesHeading}>
						<Command.Loading>{t.loadingMessage}</Command.Loading>
					</Command.Group>
				{:else if entityHits.length > 0}
					<Command.Group heading={t.entriesHeading}>
						{#each entityHits as hit (hit.id)}
							{@render entryRow(hit)}
						{/each}
					</Command.Group>
				{/if}
			{/if}
		{:else}
			{#if isQuestion && askHref}
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
							{@render entryRow(hit)}
						{/each}
					{/if}
				</Command.Group>
			{/if}
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
		<!-- T5 (round fifteen), issue #432: the shared `KeyHint` shape, and its own
		     hidden-below-`sm` default now applies here too - a phone reached this
		     dialog through `PhoneNav`'s search icon and has no arrow keys either. -->
		<KeyHint pairs={footerPairs} class="border-t border-line bg-panel-2 px-3 py-1.5" />
	</Command.Dialog>
{/if}
