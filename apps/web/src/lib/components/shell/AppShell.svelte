<script lang="ts">
	/**
	 * Issue #141 (I3 = B): the shell for the whole product, not only a universe. Reads
	 * `page.data` from `$app/state` directly rather than props threaded down from the
	 * root layout - SvelteKit already merges every ancestor layout's load data onto
	 * `page.data`, so `u/[universe]/+layout.server.ts`'s `current`/`universeSlug`/
	 * `recent`/`navCounts` show up here for free on any route nested under a universe,
	 * and are simply absent everywhere else. That absence is the mode switch: no
	 * store, no context, no prop drilling.
	 *
	 * Three renders, not two:
	 * - Signed out: pass-through, zero chrome. The door page (`routes/+page.svelte`)
	 *   and the auth pages (#139) each build their own frame; nothing here to double
	 *   up with.
	 * - Signed in, `current` present: universe mode, A2's original sidebar.
	 * - Signed in, `current` absent: account mode, this issue's new one.
	 *
	 * The public players' wiki (`routes/p/**`, decision E7) is a fourth case that is
	 * not a mode of this component at all - it keeps its own light chrome regardless
	 * of sign-in state (a GM previewing a share link while signed in still sees the
	 * public chrome, not their own account's), so this passes through unconditionally
	 * on that subtree.
	 */
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import type { Locale } from '$lib/i18n';
	import CommandPalette from '../palette/CommandPalette.svelte';
	import PhoneNav from './PhoneNav.svelte';
	import Sidebar from './Sidebar.svelte';
	import type { RecentEntity, ShellQuota, UniverseSummary } from './types';

	let { children }: { children: Snippet } = $props();

	/** The fields every route's merged `page.data` actually carries, typed locally -
	 * `App.PageData` stays the SvelteKit default (`Record<string, any>`) because most
	 * of these fields are only present on some routes, which is the whole point of the
	 * mode switch below and not something a single global interface should paper over. */
	interface ShellPageData {
		user: { id: string; name: string; email: string } | null;
		locale: Locale;
		universes: UniverseSummary[];
		current?: UniverseSummary;
		universeSlug?: string;
		recent?: RecentEntity[];
		navCounts?: { entries: number; proposals: number };
		shellQuota: ShellQuota | null;
	}

	const data = $derived(page.data as ShellPageData);
	const isPublicWiki = $derived(
		page.route.id === '/p' || (page.route.id?.startsWith('/p/') ?? false)
	);

	// Issue #148 (I10 = B): `/u/[universe]/table` already carries its own phone-shaped
	// top strip (`ContextStrip`) and bottom tabs (`PhoneTabBar`, E4's original) -
	// mounting PhoneNav there too would stack two top bars and two tab bars on a
	// 390px screen, exactly the "two navigation patterns at once" this issue rules
	// out. Every other signed-in route gets PhoneNav; this one keeps what it has.
	const isTableMode = $derived(page.route.id === '/u/[universe]/table');
</script>

{#if isPublicWiki || !data.user}
	{@render children()}
{:else}
	<div class="flex h-screen bg-paper">
		<Sidebar
			mode={data.current ? 'universe' : 'account'}
			universeSlug={data.universeSlug ?? null}
			current={data.current ?? null}
			universes={data.universes}
			recent={data.recent ?? []}
			entryCount={data.navCounts?.entries ?? 0}
			proposalsPending={data.navCounts?.proposals ?? 0}
			locale={data.locale}
			user={data.user}
			quota={data.shellQuota}
		/>
		<div class="flex min-w-0 flex-1 flex-col">
			{#if !isTableMode}
				<PhoneNav
					mode={data.current ? 'universe' : 'account'}
					universeSlug={data.universeSlug ?? null}
					current={data.current ?? null}
					universes={data.universes}
					recent={data.recent ?? []}
					entryCount={data.navCounts?.entries ?? 0}
					proposalsPending={data.navCounts?.proposals ?? 0}
					locale={data.locale}
					user={data.user}
					quota={data.shellQuota}
				/>
			{/if}
			<main
				id="main"
				class="min-w-0 flex-1 overflow-y-auto p-4 md:p-8"
				class:pb-20={!isTableMode && !!data.current}
			>
				{@render children()}
			</main>
		</div>
	</div>
	<CommandPalette
		mode={data.current ? 'universe' : 'account'}
		universeSlug={data.universeSlug ?? null}
		universes={data.universes}
		locale={data.locale}
	/>
{/if}
