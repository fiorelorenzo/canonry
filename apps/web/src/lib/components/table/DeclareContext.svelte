<script lang="ts">
	/**
	 * #72's declaration widget, rebuilt here because it never shipped a UI in apps/web (only
	 * `declareContextAndPin` in packages/warm exists) and #73 cannot be demonstrated without
	 * one: "an autocomplete over place-typed entities surfaced from a context chip, not a
	 * free-text box a model has to parse into an entity id" (e1-table-layout.html's own
	 * lock-in). Filtering the place list is a client-side substring match over the small,
	 * already-loaded candidate set - genuinely zero milliseconds, faster than the instant
	 * lane's own 100 ms budget, because there is no round trip at all until submit.
	 */
	import { messages, type Locale } from '$lib/i18n';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import type { EntityRef } from './types';

	let {
		places,
		sessions,
		initialPlaceId,
		initialSessionId,
		locale,
		onDeclare,
		onCancel
	}: {
		places: EntityRef[];
		sessions: EntityRef[];
		initialPlaceId: string | null;
		initialSessionId: string | null;
		locale: Locale;
		onDeclare: (input: { placeEntityId: string | null; sessionEntityId: string | null }) => void;
		onCancel: () => void;
	} = $props();

	const t = $derived(messages(locale).table.declareContext);

	let placeQuery = $state('');
	let selectedPlaceId = $state(initialPlaceId);
	let selectedSessionId = $state(initialSessionId);

	const filteredPlaces = $derived(
		placeQuery.trim().length === 0
			? places
			: places.filter((place) => place.name.toLowerCase().includes(placeQuery.trim().toLowerCase()))
	);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		onDeclare({ placeEntityId: selectedPlaceId, sessionEntityId: selectedSessionId });
	}
</script>

<form
	onsubmit={submit}
	class="flex flex-col gap-3 rounded-lg border border-line-2 bg-panel-2 p-3"
	aria-label={t.formLabel}
>
	<div class="flex flex-col gap-1">
		<label for="table-place-query" class="font-mono text-[10px] tracking-wide text-muted uppercase">
			{t.whereArePlayers}
		</label>
		<Input
			id="table-place-query"
			type="text"
			bind:value={placeQuery}
			placeholder={t.placePlaceholder}
			class="font-mono"
			autocomplete="off"
		/>
		<ul
			class="flex max-h-40 flex-col gap-0.5 overflow-y-auto"
			role="listbox"
			aria-label={t.placeCandidatesLabel}
		>
			{#each filteredPlaces as place (place.id)}
				<li>
					<Button
						type="button"
						variant="ghost"
						role="option"
						aria-selected={selectedPlaceId === place.id}
						onclick={() => (selectedPlaceId = place.id)}
						class={`h-auto w-full items-center justify-between rounded-md px-2 py-1 text-left text-sm font-normal ${selectedPlaceId === place.id ? 'bg-accent-bg text-accent-ink hover:bg-accent-bg' : ''}`}
					>
						<span>{place.name}</span>
						<span class="text-xs text-muted">{t.placeTag}</span>
					</Button>
				</li>
			{:else}
				<li class="px-2 py-1 text-xs text-muted">{t.noPlaceMatch(placeQuery)}</li>
			{/each}
		</ul>
	</div>

	<div class="flex flex-col gap-1">
		<label for="table-session" class="font-mono text-[10px] tracking-wide text-muted uppercase">
			{t.sessionLabel}
		</label>
		<select
			id="table-session"
			bind:value={selectedSessionId}
			class="rounded-md border border-line-2 bg-panel px-2.5 py-1.5 text-sm text-ink"
		>
			<option value={null}>{t.noSessionOption}</option>
			{#each sessions as session (session.id)}
				<option value={session.id}>{session.name}</option>
			{/each}
		</select>
	</div>

	<div class="flex justify-end gap-2">
		<Button type="button" variant="secondary" onclick={onCancel}>
			{t.cancel}
		</Button>
		<Button type="submit" disabled={!selectedPlaceId}>
			{t.declare}
		</Button>
	</div>
</form>
