<script lang="ts">
	/**
	 * Issue #73's instant-lane card, sharing E2's warm/warming/cold vocabulary with the
	 * material #77's triggers pre-compute (its own lock-in note: "the pinned NPC card and
	 * the pre-warmed brief share one component, not two"). The pin itself - name, type, why
	 * it is here - is always present, from the 2-hop graph query alone; the warm footer is
	 * the only part of this card that can ever say "not yet" or "not this session", and it
	 * never spins while saying it (decision E2 = A, no promised time, no spinner).
	 */
	import { resolve } from '$app/paths';
	import type { PinCard } from './types';

	let { pins, universeSlug }: { pins: PinCard[]; universeSlug: string } = $props();

	function initialsOf(name: string): string {
		const parts = name.split(/\s+/).filter(Boolean);
		if (parts.length === 0) return '?';
		if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
		return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
	}

	function relativeTime(iso: string): string {
		const ms = Date.now() - new Date(iso).getTime();
		const minutes = Math.round(ms / 60000);
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.round(minutes / 60);
		return `${hours}h ago`;
	}
</script>

{#if pins.length === 0}
	<p class="text-sm text-muted">
		No relations two hops from the declared place yet - the pinned column fills in once one exists.
	</p>
{:else}
	<ul class="flex flex-wrap gap-3" aria-label="Pinned by the declared place">
		{#each pins as pin (pin.entityId)}
			<li class="w-[13rem] rounded-lg border border-line bg-panel p-3">
				<div class="flex items-start gap-2.5">
					<span
						class="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-accent-bg font-mono text-xs font-bold text-accent-ink"
					>
						{initialsOf(pin.name)}
					</span>
					<div class="min-w-0">
						<a
							href={resolve(`/u/${universeSlug}/e/${pin.slug}`)}
							class="block truncate text-sm font-semibold text-ink hover:underline"
						>
							{pin.name}
						</a>
						<p class="text-xs text-muted">{pin.type}</p>
					</div>
				</div>
				<p class="mt-2 text-xs text-ink-2">
					{#if pin.via}
						{pin.via.relationLabel}
						{pin.via.entityName}
					{:else}
						{pin.hopDistance === 0
							? 'the declared place'
							: `${pin.hopDistance} hop from the declared place`}
					{/if}
				</p>
				<div class="mt-2.5 flex items-center gap-1.5 border-t border-line pt-2 text-[11px]">
					{#if pin.warm.status === 'warm'}
						<span class="h-1.5 w-1.5 flex-none rounded-full bg-accent" aria-hidden="true"></span>
						<span class="text-muted">warm brief &middot; {relativeTime(pin.warm.updatedAt)}</span>
					{:else if pin.warm.lastWarmedAt}
						<span class="h-1.5 w-1.5 flex-none rounded-full bg-muted" aria-hidden="true"></span>
						<span class="text-muted"
							>stale since {relativeTime(pin.warm.lastWarmedAt)}, refreshes next trigger</span
						>
					{:else}
						<span class="h-1.5 w-1.5 flex-none rounded-full bg-muted" aria-hidden="true"></span>
						<span class="text-muted">not warmed this session</span>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
{/if}
