<script lang="ts">
	/**
	 * #72's declaration widget, rebuilt here because it never shipped a UI in apps/web (only
	 * `declareContextAndPin` in packages/warm exists) and #73 cannot be demonstrated without
	 * one: "an autocomplete over place-typed entities surfaced from a context chip, not a
	 * free-text box a model has to parse into an entity id" (e1-table-layout.html's own
	 * lock-in). Filtering the place list is a client-side substring match over the small,
	 * already-loaded candidate set - genuinely zero milliseconds, faster than the instant
	 * lane's own 100 ms budget, because there is no round trip at all until submit.
	 *
	 * Issue #286, decision O4 = B: the session field is the campaign's own logged
	 * sessions, the GM's data, so it becomes the combobox. The place field above it is
	 * left alone on purpose: it is already a search box over a filtered list, which is
	 * what the combobox is, and #73's lock-in names that surfaced-from-a-context-chip
	 * autocomplete specifically. Folding it into the shared control would be a second
	 * change to a surface this issue was not asked to touch, so it is filed rather than
	 * done here.
	 *
	 * **Without JavaScript this form does nothing, on purpose, and that has not changed.**
	 * Like `QuickNoteForm.svelte` next to it, it has no `action`: `onsubmit` cancels the
	 * event and the table page declares the context over `fetch`. No `<noscript>`
	 * fallback, because there is no server action for one to post to.
	 */
	import { messages, type Locale } from '$lib/i18n';
	import { Input } from '$lib/components/ui/input';
	import { Combobox } from '$lib/components/ui/combobox';
	import { Button } from '$lib/components/ui/button';
	import type { EntityRef } from './types';

	let {
		places,
		sessions,
		initialPlaceId,
		initialSessionId,
		locale,
		pending = false,
		onDeclare,
		onCancel
	}: {
		places: EntityRef[];
		sessions: EntityRef[];
		initialPlaceId: string | null;
		initialSessionId: string | null;
		locale: Locale;
		/** #497 (V11): true while the parent's own `fetch` to `/table/context` is in
		 * flight - threaded in rather than tracked locally, since the request itself is
		 * made by the page, not by this form. */
		pending?: boolean;
		onDeclare: (input: { placeEntityId: string | null; sessionEntityId: string | null }) => void;
		onCancel: () => void;
	} = $props();

	const t = $derived(messages(locale).table.declareContext);
	const tControls = $derived(messages(locale).controls);

	// "No session" stays a real row rather than a cleared field: it is an answer a GM
	// gives on purpose, the same way the old <select>'s first <option> was.
	const NO_SESSION = '';
	const sessionOptions = $derived([
		{ value: NO_SESSION, label: t.noSessionOption },
		...sessions.map((session) => ({ value: session.id, label: session.name }))
	]);

	let placeQuery = $state('');
	let selectedPlaceId = $state(initialPlaceId);
	let selectedSessionId = $state(initialSessionId ?? NO_SESSION);

	const filteredPlaces = $derived(
		placeQuery.trim().length === 0
			? places
			: places.filter((place) => place.name.toLowerCase().includes(placeQuery.trim().toLowerCase()))
	);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		onDeclare({ placeEntityId: selectedPlaceId, sessionEntityId: selectedSessionId || null });
	}
</script>

<form
	onsubmit={submit}
	class="flex flex-col gap-3 rounded-lg border border-line-2 bg-panel-2 p-3"
	aria-label={t.formLabel}
>
	<div class="flex flex-col gap-1">
		<label for="table-place-query" class="font-mono text-label tracking-wide text-muted uppercase">
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
						class={`h-auto w-full items-center justify-between rounded-md px-2 py-1 text-left text-body font-normal ${selectedPlaceId === place.id ? 'bg-accent-bg text-accent-ink hover:bg-accent-bg' : ''}`}
					>
						<span>{place.name}</span>
						<span class="text-label text-muted">{t.placeTag}</span>
					</Button>
				</li>
			{:else}
				<li class="px-2 py-1 text-label text-muted">{t.noPlaceMatch(placeQuery)}</li>
			{/each}
		</ul>
	</div>

	<div class="flex flex-col gap-1">
		<label for="table-session" class="font-mono text-label tracking-wide text-muted uppercase">
			{t.sessionLabel}
		</label>
		<Combobox
			id="table-session"
			bind:value={selectedSessionId}
			options={sessionOptions}
			placeholder={t.noSessionOption}
			searchPlaceholder={tControls.search}
			emptyText={tControls.noMatch}
		/>
	</div>

	<div class="flex justify-end gap-2">
		<Button type="button" variant="secondary" onclick={onCancel}>
			{t.cancel}
		</Button>
		<Button type="submit" disabled={!selectedPlaceId || pending}>
			{pending ? t.declaring : t.declare}
		</Button>
	</div>
</form>
