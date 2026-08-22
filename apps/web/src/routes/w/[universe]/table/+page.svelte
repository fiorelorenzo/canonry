<script lang="ts">
	/**
	 * Round eighteen, W1 = A (#529): table mode as one screen showing what the copilot has
	 * already written and paid for, not a card that says a brief exists without showing it.
	 * The action bar, the ambient mood control and search are persistent chrome, rendered
	 * once above the board/deck split and shown at every viewport - "a persistent action
	 * bar, not a dock" holds on a phone exactly as it does on a laptop. Below that: at
	 * `sm` (640px) and up this is the board, the declared place with its own brief and its
	 * context_pack, every pinned NPC's brief in full, this session's SSE arrivals newest
	 * first, and a quick note. Below 640px `TableDeck` takes over that part alone - one
	 * card at a time, place first, then every pin, with a thumbnail strip to jump between
	 * them. E3 = C's two-tier dock is rejected outright: every action here fires in the
	 * one tap that starts it, never a second tap through an overflow first.
	 */
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import AmbientPlayer from '$lib/components/audio/AmbientPlayer.svelte';
	import ContextStrip from '$lib/components/table/ContextStrip.svelte';
	import { PageHeader, PageBody } from '$lib/components/ui/page-header';
	import DeclareContext from '$lib/components/table/DeclareContext.svelte';
	import PinnedCards from '$lib/components/table/PinnedCards.svelte';
	import QuickActionDock from '$lib/components/table/QuickActionDock.svelte';
	import QuickNoteForm from '$lib/components/table/QuickNoteForm.svelte';
	import InstantSearch from '$lib/components/table/InstantSearch.svelte';
	import TableDeck from '$lib/components/table/TableDeck.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Combobox } from '$lib/components/ui/combobox';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { connectTableStream, type TableStreamMessage } from '$lib/components/table/stream-client';
	import { messages } from '$lib/i18n';
	import type { ProposalSummary } from '$lib/components/table/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const t = $derived(messages(data.locale).table);
	const tControls = $derived(messages(data.locale).controls);

	let context = $state(data.context);
	let pins = $state(data.pins);
	let pinnedElapsedMs = $state<number | null>(data.pinnedElapsedMs);
	let ambientPack = $state(data.ambientPack);
	let placeBrief = $state(data.placeBrief);

	// `data` changes on `invalidateAll()` (declaring context, marking revealed, exiting);
	// SSE messages and optimistic updates below also write these directly, so they stay
	// `$state` rather than `$derived` - this effect is only the "resync from the server"
	// half of that, not the only writer.
	$effect(() => {
		context = data.context;
		pins = data.pins;
		pinnedElapsedMs = data.pinnedElapsedMs;
		ambientPack = data.ambientPack;
		placeBrief = data.placeBrief;
	});

	let showDeclareForm = $state(false);
	let showNoteForm = $state(false);
	let npcPending = $state(false);
	// #497 (V11): a submit control's own pending state, threaded down as props since the
	// fetch that answers it lives here, not in the child form. `locationCreating` is
	// scoped separately from `npcPending`: the location write settles with its own fetch
	// response (the toast below fires the instant it resolves), where the NPC one keeps
	// running server-side and only resolves later over the SSE stream's `drafting`
	// status (`onmessage` above) - two different completion signals, two flags.
	let declaringContext = $state(false);
	let locationCreating = $state(false);
	let noteSubmitting = $state(false);
	let toast = $state<string | null>(null);
	let proposals = $state<ProposalSummary[]>([]);
	let sessionEndedBanner = $state<string | null>(null);
	let quickPlaceId = $state<string | null>(null);

	interface Arrival {
		id: number;
		text: string;
	}
	// #529: "arrived now", the right column's ordered feed - G8's propagation, which used
	// to run silent behind only a count on the exit button, made discoverable rather than
	// invisible. Newest first, and only the three kinds the decision names: a proposal
	// landing (a note worded distinctly from any other quick action) and a reveal.
	let arrivals = $state<Arrival[]>([]);

	function pushArrival(id: number, text: string) {
		arrivals = [{ id, text }, ...arrivals];
	}

	// The three quick actions publish a stable id over SSE (never a display phrase, which
	// would freeze that event's "via"/"action" attribution in whatever locale published
	// it) - this is the one place that id becomes the label the action bar's own buttons
	// show, so a GM never sees a mix of one translated phrase and one English one for the
	// same tap (`table.actionLabels`, shared with `QuickActionDock.svelte`).
	function actionLabel(id: 'npc-here' | 'create-child-location' | 'quick-note'): string {
		if (id === 'npc-here') return t.actionLabels.npcHere;
		if (id === 'create-child-location') return t.actionLabels.createChildLocation;
		return t.actionLabels.quickNote;
	}

	// `fireAction`'s own kind, for the one client-side fallback toast that never reaches
	// the server's own (already-localized) error message at all - a network failure before
	// `response.json()` can even parse.
	function kindLabel(kind: 'npc' | 'location' | 'reveal'): string {
		if (kind === 'npc') return t.actionLabels.npcHere;
		if (kind === 'location') return t.actionLabels.createChildLocation;
		return t.quickActionDock.markAsRevealed;
	}

	function showToast(message: string) {
		toast = message;
		setTimeout(() => {
			if (toast === message) toast = null;
		}, 4000);
	}

	function handleStreamMessage(message: TableStreamMessage) {
		if (message.type === 'context') {
			const payload = message.data as {
				context: {
					placeEntityId: string | null;
					sessionEntityId: string | null;
					moment: string;
					situation: string;
					startedAt: string;
					id: string;
				};
				pinned: typeof pins;
			};
			pins = payload.pinned;
		} else if (message.type === 'quick-action') {
			const payload = message.data as {
				action: 'npc-here' | 'create-child-location';
				status?: string;
				reason?: string;
				placeEntityId?: string;
			};
			if (payload.status === 'drafting') showToast(t.home.draftingNpc);
			else if (payload.status === 'failed')
				showToast(
					t.home.actionFailed(actionLabel(payload.action), payload.reason ?? t.home.unknownReason)
				);
			npcPending = payload.status === 'drafting';
		} else if (message.type === 'proposal') {
			const payload = message.data as ProposalSummary;
			proposals = [...proposals, payload];
			npcPending = false;
			const text =
				payload.via === 'quick-note'
					? t.home.arrivals.noteSaved(payload.targetName ?? actionLabel(payload.via))
					: payload.drafted === 'scaffold'
						? t.home.savedAsProposalScaffold(actionLabel(payload.via))
						: t.home.savedAsProposal(actionLabel(payload.via));
			showToast(text);
			pushArrival(message.id, text);
		} else if (message.type === 'reveal') {
			const payload = message.data as { name: string };
			const text = t.home.markedRevealed(payload.name);
			showToast(text);
			pushArrival(message.id, text);
		} else if (message.type === 'session-ended') {
			sessionEndedBanner = t.home.sessionEnded(proposals.length);
		}
	}

	// `EventSource` is a browser-only global - `$effect` bodies never run during SSR (only
	// after mount, client-side), unlike top-level `<script>` code which SSR executes too.
	// Connecting here rather than at the top level is what keeps `/table`'s first page load
	// from crashing with "EventSource is not defined" on the server. `untrack` is what keeps
	// this connection open for the component's whole lifetime rather than every
	// `invalidateAll()` (declaring context, firing "mark as revealed", exiting): reading
	// `data.universeSlug` untracked means the effect has no reactive dependency on `data`,
	// so a load rerun never closes and reopens a fresh `EventSource`. That reopen was a real
	// bug, not a hypothetical one - a brand-new `EventSource` carries no `Last-Event-ID` of
	// its own, so the server (correctly, by its own contract for a connection with no
	// history) replays the *whole* backlog again, and every event already rendered on this
	// connection would double up. The universe never changes without a full route
	// navigation (a new component instance), so reading it once, untracked, is exactly right.
	let stream: ReturnType<typeof connectTableStream> | undefined;
	$effect(() => {
		const universeSlug = untrack(() => data.universeSlug);
		stream = connectTableStream(universeSlug, handleStreamMessage);
		return () => stream?.close();
	});

	async function declareContext(input: {
		placeEntityId: string | null;
		sessionEntityId: string | null;
	}) {
		declaringContext = true;
		try {
			const response = await fetch(`/w/${data.universeSlug}/table/context`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(input)
			});
			if (!response.ok) return;
			const body = (await response.json()) as {
				context: {
					placeEntityId: string | null;
					sessionEntityId: string | null;
					moment: string;
					situation: string;
					startedAt: string;
					id: string;
				};
				pinned: typeof pins;
				elapsedMs: number;
			};
			pins = body.pinned;
			pinnedElapsedMs = body.elapsedMs;
			sessionEndedBanner = null;
			showDeclareForm = false;
			await invalidateAll();
			context = data.context;
			placeBrief = data.placeBrief;
		} finally {
			declaringContext = false;
		}
	}

	// #470's empty-state combobox: session stays whatever it already was (null on a
	// fresh table, since this only runs before any place exists) - the full
	// `DeclareContext` form is still where a GM sets both together.
	function handleQuickDeclare(placeEntityId: string | null) {
		if (!placeEntityId) return;
		void declareContext({ placeEntityId, sessionEntityId: null });
	}

	async function fireAction(kind: 'npc' | 'location' | 'reveal', label?: string) {
		if (!context?.placeEntityId) return;
		if (kind === 'npc') npcPending = true;
		if (kind === 'location') locationCreating = true;
		try {
			const response = await fetch(`/w/${data.universeSlug}/table/actions`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ kind, label })
			});
			if (!response.ok) {
				npcPending = false;
				const body = (await response.json().catch(() => null)) as { message?: string } | null;
				showToast(body?.message ?? t.home.actionFailed(kindLabel(kind), t.home.unknownReason));
				return;
			}
			if (kind === 'location')
				showToast(t.home.savedAsProposal(t.actionLabels.createChildLocation));
			if (kind === 'reveal') await invalidateAll();
		} finally {
			if (kind === 'location') locationCreating = false;
		}
	}

	async function submitNote(input: { targetEntityId: string; note: string }) {
		noteSubmitting = true;
		try {
			const response = await fetch(`/w/${data.universeSlug}/table/notes`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(input)
			});
			showNoteForm = false;
			if (!response.ok) showToast(t.home.noteSaveFailed);
		} finally {
			noteSubmitting = false;
		}
	}

	// #529: TableDeck's fixed contract calls `onNote(text, pinId)` - that argument order
	// and shape is the deck's own, not this route's - so this adapts it onto the one
	// `/table/notes` call every note-taking surface on this page already shares.
	function handleDeckNote(text: string, targetEntityId: string) {
		void submitNote({ targetEntityId, note: text });
	}

	// #529: TableDeck's "mark as revealed" lives on a pin card by construction (one card
	// fills the screen), but reveal itself is still place-scoped (G7, a non-goal here) -
	// every card's button reveals the one declared place, same as the board's own action
	// bar button does.
	function handleDeckReveal() {
		void fireAction('reveal');
	}

	async function exitTableMode() {
		await fetch(`/w/${data.universeSlug}/table/end`, { method: 'POST' });
		sessionEndedBanner = t.home.sessionEnded(proposals.length);
		context = null;
		pins = [];
		await invalidateAll();
	}

	function focusSearch() {
		document.getElementById('table-instant-search')?.focus();
	}

	// The empty state's own quick-declare `Combobox` (#470, O4 = B): the same place
	// list `DeclareContext` already receives, shaped into the control layer's option
	// type.
	const placeOptions = $derived(
		data.places.map((place) => ({ value: place.id, label: place.name }))
	);

	const noteTargets = $derived(
		pins
			.map((pin) => ({ id: pin.entityId, name: pin.name, slug: pin.slug }))
			.concat(
				context?.placeEntityId && context.placeName
					? [{ id: context.placeEntityId, name: context.placeName, slug: '' }]
					: []
			)
	);

	// TableDeck's fixed contract takes `placeBrief: string | null`, not the `BriefStatus`
	// object every other surface on this page reads - staleness has nowhere to render on
	// a card with no room for a second line about its own cache, so the deck gets the text
	// (or null) and nothing else.
	const deckPlaceBrief = $derived(placeBrief?.status === 'ready' ? placeBrief.text : null);
</script>

<PageHeader title={t.title} />

<ContextStrip
	{context}
	universeName={data.universeName}
	{pinnedElapsedMs}
	proposalCount={proposals.length}
	locale={data.locale}
	onChangeContext={() => (showDeclareForm = !showDeclareForm)}
	onExit={exitTableMode}
/>

<!-- V1 = B (#494): this was a second, nested `<main>` inside AppShell's own
     `<main id="main">` - a `<div>` now, since a table-mode route is still
     signed-in-with-a-universe and AppShell always supplies the one real landmark
     there. `max-w-4xl` is gone too: table mode is explicitly named as one of the
     three "wide" routes in the decision, full bleed rather than a Tailwind class
     nobody chose. -->
<PageBody width="wide">
	<div class="flex flex-col gap-5 px-4 py-5">
		<!-- #367 (Q6): things on this page arrive rather than being there. This banner and
		     the toast below it are a state that changed where a GM mid-session would
		     otherwise wonder whether the tap registered; the declare and note forms are
		     panels expanding in place. Nothing leaves on an animation: at a table an action
		     has to be over when the finger lifts. Table mode never renders `ModelRunning`,
		     so none of this competes with a model.

		     #529 (round eighteen) adds the arrivals column: each row fades in exactly once
		     as it lands over SSE ("a row arriving when a proposal lands", docs/ux/MOTION.md)
		     - one row at a time, never the cascade that case reserves for a list arriving
		     whole on mount, since this list never does that; it starts empty and grows one
		     arrival at a time for as long as the session runs. -->
		{#if sessionEndedBanner}
			<div
				class="animate-in rounded-md border border-line-2 bg-panel-2 p-3 text-sm text-ink-2 duration-move ease-arrive fade-in-0 slide-in-from-top-1"
			>
				{sessionEndedBanner}
			</div>
		{/if}

		{#if toast}
			<div
				class="animate-in rounded-md border border-line-2 bg-panel-2 px-3 py-2 text-sm text-ink-2 duration-move ease-arrive fade-in-0 slide-in-from-top-1"
				role="status"
			>
				{toast}
			</div>
		{/if}

		{#if showDeclareForm}
			<div class="animate-in duration-move ease-arrive fade-in-0 slide-in-from-top-1">
				<DeclareContext
					places={data.places}
					sessions={data.sessions}
					initialPlaceId={context?.placeEntityId ?? null}
					initialSessionId={context?.sessionEntityId ?? null}
					locale={data.locale}
					pending={declaringContext}
					onDeclare={declareContext}
					onCancel={() => (showDeclareForm = false)}
				/>
			</div>
		{/if}

		{#if !context?.placeEntityId}
			<EmptyState kind="cold" message={t.home.noContextDeclared}>
				{#snippet action()}
					<div class="flex w-full max-w-xs flex-col gap-1">
						<label
							for="table-quick-place"
							class="font-mono text-label tracking-wide text-muted uppercase"
						>
							{t.declareContext.whereArePlayers}
						</label>
						<Combobox
							id="table-quick-place"
							bind:value={quickPlaceId}
							options={placeOptions}
							placeholder={t.home.choosePlace}
							searchPlaceholder={tControls.search}
							emptyText={tControls.noMatch}
							onchange={handleQuickDeclare}
						/>
					</div>
				{/snippet}
			</EmptyState>
		{:else}
			<!-- #529: the action bar, the ambient mood control and search are persistent
			     chrome - "a persistent action bar, not a dock" - so all three render once,
			     above the board/deck split, and stay identical at every viewport instead
			     of disappearing below `sm`. -->
			<QuickActionDock
				canReveal={context.sessionEntityId !== null}
				{npcPending}
				locationPending={locationCreating}
				locale={data.locale}
				onMarkRevealed={() => fireAction('reveal')}
				onNpcHere={() => fireAction('npc')}
				onCreateLocation={(label) => fireAction('location', label)}
				onSearchFocus={focusSearch}
			/>
			<!-- The mixer as it already ships (#69, SPEC 8): a master volume plus per-layer mute
			     and volume, persisted per device and keyed by user id, which is why it needs
			     `userId`. An earlier pass of this rebuild replaced the whole thing with one mood
			     control and deleted `audio/prefs.ts` with it; retiring a decided feature is not
			     table mode's call to make, so it is mounted intact. -->
			<AmbientPlayer
				universeSlug={data.universeSlug}
				userId={data.userId}
				pack={ambientPack}
				locale={data.locale}
			/>
			<div class="border-t border-line pt-5">
				<InstantSearch universeSlug={data.universeSlug} locale={data.locale} />
			</div>

			<!-- The board: `sm` (640px) and up, one continuous screen, nothing behind a
			     tab. Below that, `TableDeck` takes over the place-and-pins portion alone
			     (its own file, #529): one card at a time, large enough to read from a
			     metre, with a thumbnail strip to jump between them. -->
			<div class="hidden sm:flex sm:flex-col sm:gap-6">
				<div class="flex flex-col gap-6 lg:flex-row lg:items-start">
					<div class="flex flex-col gap-6 lg:min-w-0 lg:flex-1">
						<section aria-labelledby="table-place-heading" class="border-b border-line pb-5">
							<p class="text-label font-semibold tracking-wide text-muted uppercase">
								{t.home.placeHeading}
							</p>
							<h2 id="table-place-heading" class="mt-1 text-title font-semibold text-ink">
								{context.placeName}
							</h2>
							<p class="mt-2 text-body text-ink-2">
								{placeBrief?.status === 'ready'
									? (placeBrief.text ?? t.brief.missing)
									: t.brief.missing}
							</p>
							{#if placeBrief?.status === 'ready' && placeBrief.stale}
								<p class="mt-1 text-label text-muted">{t.brief.mayBeOutdated}</p>
							{/if}
						</section>

						<section aria-labelledby="table-here-heading">
							<h2
								id="table-here-heading"
								class="mb-2 text-label font-semibold tracking-wide text-muted uppercase"
							>
								{t.home.hereHeading}
							</h2>
							<PinnedCards {pins} universeSlug={data.universeSlug} locale={data.locale} />
						</section>
					</div>

					<div class="flex flex-col gap-6 lg:w-80 lg:flex-none">
						<section aria-labelledby="table-arrivals-heading">
							<h2
								id="table-arrivals-heading"
								class="mb-2 text-label font-semibold tracking-wide text-muted uppercase"
							>
								{t.home.arrivals.heading}
							</h2>
							{#if arrivals.length === 0}
								<p class="text-sm text-muted">{t.home.arrivals.empty}</p>
							{:else}
								<ul class="flex flex-col" aria-live="polite">
									{#each arrivals as arrival (arrival.id)}
										<li
											class="animate-in border-b border-line py-2 text-sm text-ink-2 duration-fade ease-arrive fade-in-0 last:border-b-0"
										>
											{arrival.text}
										</li>
									{/each}
								</ul>
							{/if}
						</section>

						<section aria-labelledby="table-note-heading">
							<div class="flex items-center justify-between gap-2">
								<h2
									id="table-note-heading"
									class="text-label font-semibold tracking-wide text-muted uppercase"
								>
									{t.home.noteHeading}
								</h2>
								{#if !showNoteForm}
									<Button
										type="button"
										variant="secondary"
										size="sm"
										onclick={() => (showNoteForm = true)}
									>
										{t.quickActionDock.jotNote}
									</Button>
								{/if}
							</div>
							{#if showNoteForm}
								<div
									class="mt-2 animate-in duration-move ease-arrive fade-in-0 slide-in-from-top-1"
								>
									<QuickNoteForm
										targets={noteTargets}
										locale={data.locale}
										pending={noteSubmitting}
										onSubmit={submitNote}
										onCancel={() => (showNoteForm = false)}
									/>
								</div>
							{/if}
						</section>
					</div>
				</div>
			</div>

			<div class="sm:hidden">
				<TableDeck
					{pins}
					placeName={context.placeName ?? ''}
					placeBrief={deckPlaceBrief}
					canReveal={context.sessionEntityId !== null}
					locale={data.locale}
					onNote={handleDeckNote}
					onReveal={handleDeckReveal}
				/>
			</div>
		{/if}
	</div>
</PageBody>
