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
		pinnedElapsedMs,
		proposalCount,
		locale,
		onChangeContext,
		onExit
	}: {
		context: TableContext | null;
		pinnedElapsedMs: number | null;
		proposalCount: number;
		locale: Locale;
		onChangeContext: () => void;
		onExit: () => void;
	} = $props();

	const t = $derived(messages(locale).table.contextStrip);
</script>

<div
	class="flex flex-wrap items-center gap-3 border-b border-line bg-panel px-4 py-2.5 text-body text-ink-2"
>
	{#if context?.placeName}
		<span class="font-semibold text-ink">{t.modeOn}</span>
		<span aria-hidden="true">&middot;</span>
		<span>{context.placeName}</span>
		{#if context.sessionName}
			<span class="text-muted">, {context.sessionName}</span>
		{/if}
		{#if pinnedElapsedMs !== null}
			<Badge variant="secondary" class="font-mono text-muted">
				{t.pinnedIn(pinnedElapsedMs)}
			</Badge>
		{/if}
		<span class="flex-1"></span>
		<!-- #792: the one way to change the declared place afterwards - `+page.svelte`
			opens the same `DeclareContext` form this button opened the session with. -->
		<Button type="button" variant="secondary" size="sm" onclick={onChangeContext}>
			{t.change}
		</Button>
		<!-- #792: only reachable once a session is actually running - `title` states
			`table/end/+server.ts`'s real consequence rather than leaving "exit" to guess. -->
		<Button type="button" variant="secondary" size="sm" onclick={onExit} title={t.exitTooltip}>
			{t.exit}
			{#if proposalCount > 0}
				<!-- Round eleven P2 (#344): the count pill, on the accent's tint, matching the
					proposals inbox. -->
				<span
					class="ml-1 rounded-full bg-accent-bg px-1.5 py-0.5 font-mono text-label text-accent-ink"
				>
					{proposalCount}
				</span>
			{/if}
		</Button>
	{:else}
		<!-- #792: the not-started chip is the whole strip - no change/exit control, since
			there is nothing yet to change or leave. `+page.svelte`'s cold `EmptyState`
			carries the one control that begins a session. -->
		<span class="text-ink-2">{t.notStarted}</span>
	{/if}
</div>
