<script lang="ts">
	/**
	 * A2 = A: universe switcher on top of the fixed sidebar. Expanding it shows
	 * precedence in place (SPEC.md 4.1): a derived universe's row carries which
	 * universe it reads from underneath its own canon, and every row carries its own
	 * entity count, so the switcher is never decorative.
	 *
	 * A disclosure, not a listbox: activating a row navigates to a different page
	 * (the ARIA "menu" pattern), it does not select a value in place, so plain links
	 * inside a toggled region are the correct and simplest accessible shape here.
	 *
	 * Issue #141, I3 = B: `current` is nullable now - the same component serves the
	 * shell's account mode, with no universe selected. Universe mode is unchanged
	 * (the list, nothing else); account mode's trigger reads "All universes" and its
	 * panel adds two rows below the list, "All universes" and "New universe", that
	 * universe mode never shows.
	 */
	import { resolve } from '$app/paths';
	import { messages, type Locale } from '$lib/i18n';
	import { isDismissKey } from '$lib/keys';
	import type { UniverseSummary } from './types';

	let {
		current,
		universes,
		locale
	}: { current: UniverseSummary | null; universes: UniverseSummary[]; locale: Locale } = $props();

	const t = $derived(messages(locale).universe.switcher);

	let open = $state(false);
	let triggerEl: HTMLButtonElement | undefined = $state();
	let panelEl: HTMLDivElement | undefined = $state();

	const panelId = 'universe-switcher-panel';

	function close(): void {
		open = false;
		triggerEl?.focus();
	}

	function onWindowKeydown(event: KeyboardEvent): void {
		if (open && isDismissKey(event)) close();
	}

	function onWindowPointerdown(event: PointerEvent): void {
		if (!open) return;
		const target = event.target as Node;
		if (panelEl?.contains(target) || triggerEl?.contains(target)) return;
		open = false;
	}
</script>

<svelte:window onkeydown={onWindowKeydown} onpointerdown={onWindowPointerdown} />

<div class="relative">
	<button
		bind:this={triggerEl}
		type="button"
		class="flex w-full items-center justify-between gap-2 rounded-md border border-line bg-panel-2 px-2.5 py-2 text-left hover:border-line-2"
		aria-haspopup="true"
		aria-expanded={open}
		aria-controls={panelId}
		onclick={() => (open = !open)}
	>
		<span class="flex min-w-0 items-center gap-2">
			<span class="truncate text-sm font-semibold text-ink">
				{current ? current.name : t.allUniverses}
			</span>
			{#if current?.kind === 'derived'}
				<span
					class="shrink-0 rounded-full border border-ai-line bg-ai-bg px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-ai uppercase"
				>
					{t.derivedBadge}
				</span>
			{/if}
		</span>
		<span aria-hidden="true" class="shrink-0 text-muted">{open ? '▴' : '▾'}</span>
	</button>

	{#if open}
		<div
			bind:this={panelEl}
			id={panelId}
			class="absolute right-0 left-0 z-10 mt-1 max-h-96 overflow-y-auto rounded-md border border-line-2 bg-panel shadow-lg"
		>
			<nav aria-label={t.switchAriaLabel}>
				<ul class="flex flex-col">
					{#each universes as universe (universe.id)}
						<li class="border-b border-line last:border-b-0">
							<a
								href={resolve(`/u/${universe.slug}`)}
								class="flex items-start gap-2 px-3 py-2 hover:bg-panel-2"
								class:bg-accent-bg={universe.id === current?.id}
								aria-current={universe.id === current?.id ? 'page' : undefined}
								onclick={close}
							>
								<span
									aria-hidden="true"
									class={universe.kind === 'derived'
										? 'mt-1 h-2 w-2 shrink-0 rounded-full border-2 border-accent'
										: 'mt-1 h-2 w-2 shrink-0 rounded-sm bg-accent'}
								></span>
								<span class="min-w-0">
									<span class="block truncate text-sm font-medium text-ink">{universe.name}</span>
									<span class="block text-xs text-muted">
										{universe.kind}
										{#if universe.baseUniverseName}
											&middot; {t.derivedFrom(universe.baseUniverseName)}
										{/if}
										&middot; {t.entryCount(universe.entityCount)}
									</span>
								</span>
							</a>
						</li>
					{/each}
				</ul>
				{#if !current}
					<ul class="flex flex-col border-t border-line-2">
						<li>
							<a
								href={resolve('/')}
								class="block px-3 py-2 text-sm font-medium text-ink hover:bg-panel-2"
								onclick={close}
							>
								{t.allUniverses}
							</a>
						</li>
						<li>
							<a
								href={resolve('/onboarding')}
								class="block px-3 py-2 text-sm font-medium text-accent hover:bg-panel-2"
								onclick={close}
							>
								{t.newUniverse}
							</a>
						</li>
					</ul>
				{/if}
			</nav>
		</div>
	{/if}
</div>
