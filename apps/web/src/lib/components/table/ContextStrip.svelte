<script lang="ts">
	/**
	 * E1 = B's persistent strip: "a toggle in the topbar of any screen... a context strip
	 * persists across every page while it is on." Scoped here to every page under /table
	 * (this subtree's own +layout.svelte renders it) - see that file's header comment for
	 * why it does not reach into the rest of the app's shell, which is owned outside these
	 * paths. G8 = B: propagation keeps running silent while table mode is open, and the
	 * only trace is the small count riding on the exit control itself.
	 */
	import { messages, type Locale } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import type { TableContext } from './types';

	let {
		context,
		universeName,
		pinnedElapsedMs,
		proposalCount,
		locale,
		onChangeContext,
		onExit
	}: {
		context: TableContext | null;
		universeName: string;
		pinnedElapsedMs: number | null;
		proposalCount: number;
		locale: Locale;
		onChangeContext: () => void;
		onExit: () => void;
	} = $props();

	const t = $derived(messages(locale).table.contextStrip);
</script>

<div
	class="flex flex-wrap items-center gap-3 border-b border-line bg-panel px-4 py-2.5 text-sm text-ink-2"
>
	<span class="font-semibold text-ink">{t.modeOn}</span>
	<span aria-hidden="true">&middot;</span>
	{#if context?.placeName}
		<span>{context.placeName}</span>
		{#if context.sessionName}
			<span class="text-muted">, {context.sessionName}</span>
		{/if}
		{#if pinnedElapsedMs !== null}
			<Badge variant="secondary" class="font-mono text-muted">
				{t.pinnedIn(pinnedElapsedMs)}
			</Badge>
		{/if}
	{:else}
		<span class="text-muted">{t.noPlaceDeclared(universeName)}</span>
	{/if}
	<span class="flex-1"></span>
	<Button type="button" variant="secondary" size="sm" onclick={onChangeContext}>
		{t.change}
	</Button>
	<Button type="button" variant="secondary" size="sm" onclick={onExit}>
		{t.exit}
		{#if proposalCount > 0}
			<!-- Round eleven P2 (#344): the count pill, on the accent's tint. PhoneTabBar's
				queue badge and the proposals inbox match it. -->
			<span
				class="ml-1 rounded-full bg-accent-bg px-1.5 py-0.5 font-mono text-[10px] text-accent-ink"
			>
				{proposalCount}
			</span>
		{/if}
	</Button>
</div>
