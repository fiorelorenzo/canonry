<script lang="ts">
	/**
	 * E1 = B's persistent strip: "a toggle in the topbar of any screen... a context strip
	 * persists across every page while it is on." Scoped here to every page under /table
	 * (this subtree's own +layout.svelte renders it) - see that file's header comment for
	 * why it does not reach into the rest of the app's shell, which is owned outside these
	 * paths. G8 = B: propagation keeps running silent while table mode is open, and the
	 * only trace is the small count riding on the exit control itself.
	 */
	import type { TableContext } from './types';

	let {
		context,
		universeName,
		pinnedElapsedMs,
		proposalCount,
		onChangeContext,
		onExit
	}: {
		context: TableContext | null;
		universeName: string;
		pinnedElapsedMs: number | null;
		proposalCount: number;
		onChangeContext: () => void;
		onExit: () => void;
	} = $props();
</script>

<div
	class="flex flex-wrap items-center gap-3 border-b border-line bg-panel px-4 py-2.5 text-sm text-ink-2"
>
	<span class="font-semibold text-ink">Table mode: on</span>
	<span aria-hidden="true">&middot;</span>
	{#if context?.placeName}
		<span>{context.placeName}</span>
		{#if context.sessionName}
			<span class="text-muted">, {context.sessionName}</span>
		{/if}
		{#if pinnedElapsedMs !== null}
			<span class="rounded-full bg-panel-2 px-2 py-0.5 font-mono text-xs text-muted">
				pinned in {pinnedElapsedMs}ms
			</span>
		{/if}
	{:else}
		<span class="text-muted">no place declared yet - {universeName}</span>
	{/if}
	<span class="flex-1"></span>
	<button
		type="button"
		onclick={onChangeContext}
		class="rounded-md border border-line-2 px-2.5 py-1 text-xs font-medium text-ink-2 hover:bg-panel-2"
	>
		Change
	</button>
	<button
		type="button"
		onclick={onExit}
		class="rounded-md border border-line-2 px-2.5 py-1 text-xs font-medium text-ink-2 hover:bg-panel-2"
	>
		Exit table mode
		{#if proposalCount > 0}
			<span class="ml-1 rounded-full bg-ai-bg px-1.5 py-0.5 font-mono text-[10px] text-ai">
				{proposalCount}
			</span>
		{/if}
	</button>
</div>
