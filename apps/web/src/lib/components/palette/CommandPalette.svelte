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
	 * Every row is a real `Command.LinkItem` (a real `<a href>`), not an `onSelect`-only
	 * click handler - the same mod/ctrl-click-opens-a-tab behaviour a GM expects from
	 * any link keeps working here, and Enter on the focused row works by the primitive
	 * calling the anchor's own `.click()`, not a hand-written navigation. Escape closes
	 * through bits-ui's own escape-layer (Dialog's default) and ↑/↓/Enter are Command's
	 * own roving selection - none of that is `lib/keys.ts` vocabulary, which is
	 * reserved for the chords that have to agree with a platform's modifier map
	 * (mod+K, mod+shift+A), not plain list navigation.
	 */
	import { goto } from '$app/navigation';
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
		locale
	}: {
		mode: 'universe' | 'account';
		universeSlug: string | null;
		universes: UniverseSummary[];
		locale: Locale;
	} = $props();

	const t = $derived(messages(locale).shell.palette);

	// Non-null: both ids are entries this issue's own vocabulary in keys.ts carries -
	// see that file's SHORTCUTS table.
	const paletteShortcut = SHORTCUTS.find((shortcut) => shortcut.id === 'palette')!;
	const askShortcut = SHORTCUTS.find((shortcut) => shortcut.id === 'ask')!;

	let query = $state('');
	let entityHits = $state<EntitySearchHit[]>([]);
	let searching = $state(false);
	let requestSeq = 0;

	const trimmedQuery = $derived(query.trim());
	const isQuestion = $derived(looksLikeQuestion(query));
	const actions = $derived(filterActions(paletteActions(mode, universeSlug, locale), query));
	const askHref = $derived(
		universeSlug
			? `${resolve(`/u/${universeSlug}/ask`)}?q=${encodeURIComponent(trimmedQuery)}`
			: null
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
		const response = await fetch(`/u/${slug}/palette-search?q=${encodeURIComponent(q)}`);
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
		if (!slug) {
			entityHits = [];
			return;
		}
		clearTimeout(debounceHandle);
		debounceHandle = setTimeout(() => runEntitySearch(slug, q), 120);
	});

	// Reopening starts from a blank box rather than showing whatever the last search
	// left behind - the same reasoning `InstantSearch.svelte`'s own `requestSeq` guard
	// applies to a single stale response, extended here to a whole closed-then-reopened
	// session.
	$effect(() => {
		if (!paletteState.open) {
			query = '';
			entityHits = [];
			searching = false;
			requestSeq += 1;
		}
	});

	function closePalette() {
		paletteState.open = false;
	}

	function onWindowKeydown(event: KeyboardEvent) {
		if (matchesShortcut(event, paletteShortcut)) {
			event.preventDefault();
			paletteState.open = !paletteState.open;
			return;
		}
		// "Ask, directly - skipping the palette" (A3's own vocabulary table). Only live
		// with a universe in context: there is no account-level Ask route to send it to.
		if (universeSlug && matchesShortcut(event, askShortcut)) {
			event.preventDefault();
			closePalette();
			goto(resolve(`/u/${universeSlug}/ask`));
		}
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

<Command.Dialog
	bind:open={paletteState.open}
	title={t.dialogTitle}
	description={t.dialogDescription}
	closeLabel={t.closeLabel}
	shouldFilter={false}
>
	<Command.Input bind:value={query} placeholder={t.placeholder} />
	<Command.List>
		{#if mode === 'universe' && universeSlug}
			{#if isQuestion && askHref}
				<Command.Group heading={t.askHeading}>
					<Command.LinkItem href={askHref} onSelect={closePalette} class="text-ai">
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
								href={resolve(`/u/${universeSlug}/e/${hit.slug}`)}
								onSelect={closePalette}
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

		{#if mode === 'account'}
			<Command.Group heading={t.universesHeading}>
				{#if filteredUniverses.length === 0}
					<p class="px-2 py-3 text-sm text-muted">{t.noUniverseMatches(trimmedQuery)}</p>
				{:else}
					{#each filteredUniverses as universe (universe.id)}
						<Command.LinkItem href={resolve(`/u/${universe.slug}`)} onSelect={closePalette}>
							<span class="min-w-0 truncate">{universe.name}</span>
						</Command.LinkItem>
					{/each}
				{/if}
			</Command.Group>
		{/if}

		{#if actions.length > 0}
			<Command.Group heading={t.actionsHeading}>
				{#each actions as action (action.id)}
					<Command.LinkItem href={action.href} onSelect={closePalette}>
						<span class="min-w-0 truncate">{action.label}</span>
					</Command.LinkItem>
				{/each}
			</Command.Group>
		{/if}

		<Command.Empty>{t.emptyMessage}</Command.Empty>
	</Command.List>
	<div class="flex gap-3 border-t border-line bg-panel-2 px-3 py-1.5 text-xs text-muted">
		<span>↑↓ {t.footerMove}</span>
		<span>↵ {t.footerOpen}</span>
		<span>Esc {t.footerClose}</span>
	</div>
</Command.Dialog>
