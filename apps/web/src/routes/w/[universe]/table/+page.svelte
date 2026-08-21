<script lang="ts">
	/**
	 * The table-mode home screen: #73's pinned cards, #74's dock, #75's search, #80's quick
	 * note, all wired to #79's ordered SSE stream so a quick action's result and a second
	 * device's changes both arrive without a reload. #81's phone layout reuses every one of
	 * these components; only the surrounding chrome (tabs vs. one screen) differs by
	 * viewport, via `md:` - see the markup below.
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
	import PhoneTabBar from '$lib/components/table/PhoneTabBar.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Combobox } from '$lib/components/ui/combobox';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { connectTableStream, type TableStreamMessage } from '$lib/components/table/stream-client';
	import { messages } from '$lib/i18n';
	import { SHORTCUTS, formatShortcut } from '$lib/keys';
	import type { ProposalSummary } from '$lib/components/table/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const t = $derived(messages(data.locale).table);
	const tControls = $derived(messages(data.locale).controls);

	let context = $state(data.context);
	let pins = $state(data.pins);
	let pinnedElapsedMs = $state<number | null>(data.pinnedElapsedMs);
	let ambientPack = $state(data.ambientPack);

	// `data` changes on `invalidateAll()` (declaring context, marking revealed, exiting);
	// SSE messages and optimistic updates below also write these three directly, so they
	// stay `$state` rather than `$derived` - this effect is only the "resync from the
	// server" half of that, not the only writer.
	$effect(() => {
		context = data.context;
		pins = data.pins;
		pinnedElapsedMs = data.pinnedElapsedMs;
		ambientPack = data.ambientPack;
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
	let activeTab = $state<'here' | 'actions' | 'ask' | 'queue'>('here');
	let quickPlaceId = $state<string | null>(null);

	const paletteShortcut = SHORTCUTS.find((shortcut) => shortcut.id === 'palette');

	// The three quick actions publish a stable id over SSE (never a display phrase, which
	// would freeze that event's "via"/"action" attribution in whatever locale published
	// it) - this is the one place that id becomes the label the dock's own buttons show,
	// so a GM never sees a mix of one translated phrase and one English one for the same
	// tap (`table.actionLabels`, shared with `QuickActionDock.svelte`).
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
			showToast(
				payload.drafted === 'scaffold'
					? t.home.savedAsProposalScaffold(actionLabel(payload.via))
					: t.home.savedAsProposal(actionLabel(payload.via))
			);
		} else if (message.type === 'reveal') {
			const payload = message.data as { name: string };
			showToast(t.home.markedRevealed(payload.name));
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

	async function exitTableMode() {
		await fetch(`/w/${data.universeSlug}/table/end`, { method: 'POST' });
		sessionEndedBanner = t.home.sessionEnded(proposals.length);
		context = null;
		pins = [];
		await invalidateAll();
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
		<!-- #367 (Q6): four things on this page arrive rather than being there, and all four
	     are the decision's own cases. This banner and the toast below it are a state that
	     changed where a GM mid-session would otherwise wonder whether the tap registered;
	     the two forms further down are panels expanding in place. Nothing leaves on an
	     animation: at a table an action has to be over when the finger lifts. Table mode
	     never renders `ModelRunning`, so none of this competes with a model. -->
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
							class="font-mono text-[10px] tracking-wide text-muted uppercase"
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
			<section class="hidden md:block" class:!block={activeTab === 'here'}>
				<h2 class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
					{t.home.pinnedHeading}
				</h2>
				<PinnedCards {pins} universeSlug={data.universeSlug} locale={data.locale} />
			</section>

			<section
				class="hidden md:block"
				class:!block={activeTab === 'here' || activeTab === 'actions'}
			>
				<h2 class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
					{t.home.quickActionsHeading}
				</h2>
				<QuickActionDock
					canReveal={context.sessionEntityId !== null}
					{npcPending}
					locale={data.locale}
					onMarkRevealed={() => fireAction('reveal')}
					onNpcHere={() => fireAction('npc')}
					onCreateLocation={(label) => fireAction('location', label)}
					onJotNote={() => (showNoteForm = true)}
				/>
				<div class="mt-3">
					<AmbientPlayer
						universeSlug={data.universeSlug}
						userId={data.userId}
						pack={ambientPack}
						locale={data.locale}
					/>
				</div>
			</section>

			{#if showNoteForm}
				<section
					class="hidden animate-in duration-move ease-arrive fade-in-0 slide-in-from-top-1 md:block"
					class:!block={activeTab === 'actions'}
				>
					<QuickNoteForm
						targets={noteTargets}
						locale={data.locale}
						onSubmit={submitNote}
						onCancel={() => (showNoteForm = false)}
					/>
				</section>
			{/if}

			<section class="hidden md:block" class:!block={activeTab === 'here'}>
				<InstantSearch universeSlug={data.universeSlug} locale={data.locale} />
			</section>

			<section class="hidden md:block" class:!block={activeTab === 'ask'}>
				<h2 class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
					{t.home.askHeading}
				</h2>
				<p class="text-sm text-muted">
					{t.home.askNotBuilt}
					{#if paletteShortcut}
						{t.home.askOpensFromPalette(formatShortcut(paletteShortcut))}
					{/if}
				</p>
			</section>

			<section class="hidden md:block" class:!block={activeTab === 'queue'}>
				<h2 class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
					{t.home.proposalsHeading}
				</h2>
				{#if proposals.length === 0}
					<p class="text-sm text-muted">
						{t.home.proposalsEmpty}
					</p>
				{:else}
					<ul class="flex flex-col gap-1.5">
						{#each proposals as proposal (proposal.proposalId)}
							<li class="rounded-md border border-line bg-panel p-2.5 text-sm">
								<!-- Round eleven P2 (#344): both of these name a kind, they are not wording
								a model produced, so they wear the theme's own panel and line. The one
								below sits next to a Badge variant="secondary" for the scaffold case and
								now matches it, which is what it should have been doing. -->
								<span
									class="rounded-full border border-line-2 bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-2"
								>
									{t.home.proposalLabel} &middot; {proposal.kind}
								</span>
								<span class="ml-2 text-muted">{t.home.from(actionLabel(proposal.via))}</span>
								{#if proposal.drafted === 'model'}
									<span
										class="ml-2 rounded-full border border-line-2 bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-2"
										title={t.home.aiDraftedTooltip}
									>
										{t.home.aiDraftedBadge}
									</span>
								{:else if proposal.drafted === 'scaffold'}
									<Badge
										variant="secondary"
										class="ml-2 font-mono text-[10px] text-muted"
										title={proposal.unavailableReason ?? t.home.scaffoldTooltipDefault}
									>
										{t.home.scaffoldBadge}
									</Badge>
								{/if}
								{#if proposal.targetName}
									<p class="mt-1 text-ink-2">{proposal.targetName}</p>
								{:else if proposal.rationale}
									<p class="mt-1 text-ink-2">{proposal.rationale}</p>
								{/if}
								{#if proposal.preview}
									<p class="mt-1 text-xs text-ink-2">{proposal.preview}</p>
								{/if}
								{#if proposal.drafted === 'scaffold' && proposal.unavailableReason && proposal.targetName}
									<p class="mt-1 text-[11px] text-muted">
										{t.home.aiUnavailable(proposal.unavailableReason)}
									</p>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}
	</div>
</PageBody>

<PhoneTabBar
	active={activeTab}
	queueCount={proposals.length}
	locale={data.locale}
	onSelect={(tab) => (activeTab = tab)}
/>
