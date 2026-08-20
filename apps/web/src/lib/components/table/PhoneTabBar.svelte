<script lang="ts">
	/**
	 * Issue #81, decision E4 = A: "a persistent four-tab bar: Here, Actions, Ask, Queue.
	 * Whatever the GM needs is always exactly one known tap away." Sized to the artifact's
	 * own numbers - 78x48px tab target, 44px minimum row height elsewhere in this subtree -
	 * because a GM holding a phone one-handed at a lit table is the whole reason #81 exists.
	 * `md:hidden` keeps this off the desktop layout, where E1's wider screen already shows
	 * every tab's content at once with no navigation needed.
	 */
	import { messages, type Locale } from '$lib/i18n';

	let {
		active,
		queueCount,
		locale,
		onSelect
	}: {
		active: 'here' | 'actions' | 'ask' | 'queue';
		queueCount: number;
		locale: Locale;
		onSelect: (tab: 'here' | 'actions' | 'ask' | 'queue') => void;
	} = $props();

	const t = $derived(messages(locale).table.phoneTabBar);

	const TABS = $derived([
		{ id: 'here' as const, label: t.here },
		{ id: 'actions' as const, label: t.actions },
		{ id: 'ask' as const, label: t.ask },
		{ id: 'queue' as const, label: t.queue }
	]);
</script>

<!-- #147: raw tab strip on purpose - the active tab reads through text-accent-ink plus
	font-semibold, which none of Button's variants draw. Round eleven P2 (#344): the queue
	badge is the count pill on the accent's tint, matching ContextStrip and the proposals
	inbox, because a number waiting is not AI text. -->
<nav
	class="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-panel md:hidden"
	aria-label={t.navLabel}
>
	{#each TABS as tab (tab.id)}
		<button
			type="button"
			onclick={() => onSelect(tab.id)}
			aria-current={active === tab.id ? 'page' : undefined}
			class="flex min-h-[48px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-xs"
			class:text-accent-ink={active === tab.id}
			class:font-semibold={active === tab.id}
			class:text-ink-2={active !== tab.id}
		>
			<span>{tab.label}</span>
			{#if tab.id === 'queue' && queueCount > 0}
				<span class="rounded-full bg-accent-bg px-1.5 py-0 font-mono text-[9px] text-accent-ink"
					>{queueCount}</span
				>
			{/if}
		</button>
	{/each}
</nav>
