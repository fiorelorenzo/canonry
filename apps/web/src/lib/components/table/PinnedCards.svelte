<script lang="ts">
	/**
	 * Issue #73's instant-lane row, rebuilt for #529 (round eighteen, W1 = A, the board):
	 * "who is here, under it: one row per pin with its initials, name, type, its brief in
	 * full, and why it is pinned." A card that told the GM a brief existed without showing
	 * it was the defect this issue names outright, so `pin.warm.text` renders in full here
	 * rather than a relative-time footer - V3's "a card becomes a row with a rule" applies
	 * directly, since this was the clearest boxed-card-in-a-wrap-grid left in table mode.
	 */
	import { resolve } from '$app/paths';
	import { messages, type Locale } from '$lib/i18n';
	import type { PinCard } from './types';

	let { pins, universeSlug, locale }: { pins: PinCard[]; universeSlug: string; locale: Locale } =
		$props();

	const t = $derived(messages(locale).table.pinnedCards);
	const tBrief = $derived(messages(locale).table.brief);

	function initialsOf(name: string): string {
		const parts = name.split(/\s+/).filter(Boolean);
		if (parts.length === 0) return '?';
		if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
		return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
	}
</script>

{#if pins.length === 0}
	<p class="text-sm text-muted">
		{t.empty}
	</p>
{:else}
	<ul class="flex flex-col" aria-label={t.listLabel}>
		{#each pins as pin (pin.entityId)}
			<li class="flex items-start gap-3 border-b border-line py-3 last:border-b-0">
				<span
					class="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-accent-bg font-mono text-label font-bold text-accent-ink"
				>
					{initialsOf(pin.name)}
				</span>
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-baseline gap-x-2">
						<a
							href={resolve(`/w/${universeSlug}/e/${pin.slug}`)}
							class="text-title font-semibold text-ink hover:underline"
						>
							{pin.name}
						</a>
						<span class="text-meta text-muted">{pin.type}</span>
						{#if pin.hasPendingProposal}
							<span
								class="rounded-full border border-line-2 bg-panel-2 px-1.5 py-0.5 text-label text-ink-2"
							>
								{t.pendingProposal}
							</span>
						{/if}
					</div>
					<p class="mt-0.5 text-meta text-muted">
						{#if pin.via}
							{pin.via.relationLabel}
							{pin.via.entityName}
						{:else}
							{pin.hopDistance === 0 ? t.declaredPlace : t.hopsFromPlace(pin.hopDistance)}
						{/if}
					</p>
					<p class="mt-1.5 text-body text-ink-2">
						{#if pin.warm.status === 'ready'}
							{pin.warm.text ?? tBrief.missing}
							{#if pin.warm.stale}
								<span class="ml-1 text-label text-muted">({tBrief.mayBeOutdated})</span>
							{/if}
						{:else}
							<span class="text-muted">{tBrief.missing}</span>
						{/if}
					</p>
				</div>
			</li>
		{/each}
	</ul>
{/if}
