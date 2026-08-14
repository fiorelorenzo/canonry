<script lang="ts">
	/**
	 * Issue #81, decision E4 = A: "a persistent four-tab bar: Here, Actions, Ask, Queue.
	 * Whatever the GM needs is always exactly one known tap away." Sized to the artifact's
	 * own numbers - 78x48px tab target, 44px minimum row height elsewhere in this subtree -
	 * because a GM holding a phone one-handed at a lit table is the whole reason #81 exists.
	 * `md:hidden` keeps this off the desktop layout, where E1's wider screen already shows
	 * every tab's content at once with no navigation needed.
	 */
	let {
		active,
		queueCount,
		onSelect
	}: {
		active: 'here' | 'actions' | 'ask' | 'queue';
		queueCount: number;
		onSelect: (tab: 'here' | 'actions' | 'ask' | 'queue') => void;
	} = $props();

	const TABS = [
		{ id: 'here', label: 'Here' },
		{ id: 'actions', label: 'Actions' },
		{ id: 'ask', label: 'Ask' },
		{ id: 'queue', label: 'Queue' }
	] as const;
</script>

<nav
	class="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-panel md:hidden"
	aria-label="Table mode sections"
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
				<span class="rounded-full bg-ai-bg px-1.5 py-0 font-mono text-[9px] text-ai"
					>{queueCount}</span
				>
			{/if}
		</button>
	{/each}
</nav>
