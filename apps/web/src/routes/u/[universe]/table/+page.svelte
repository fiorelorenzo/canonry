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
	import DeclareContext from '$lib/components/table/DeclareContext.svelte';
	import PinnedCards from '$lib/components/table/PinnedCards.svelte';
	import QuickActionDock from '$lib/components/table/QuickActionDock.svelte';
	import QuickNoteForm from '$lib/components/table/QuickNoteForm.svelte';
	import InstantSearch from '$lib/components/table/InstantSearch.svelte';
	import PhoneTabBar from '$lib/components/table/PhoneTabBar.svelte';
	import { connectTableStream, type TableStreamMessage } from '$lib/components/table/stream-client';
	import { SHORTCUTS, formatShortcut } from '$lib/keys';
	import type { ProposalSummary } from '$lib/components/table/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

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
	let toast = $state<string | null>(null);
	let proposals = $state<ProposalSummary[]>([]);
	let sessionEndedBanner = $state<string | null>(null);
	let activeTab = $state<'here' | 'actions' | 'ask' | 'queue'>('here');
	let streamEvents = $state<TableStreamMessage[]>([]);

	const paletteShortcut = SHORTCUTS.find((shortcut) => shortcut.id === 'palette');

	function showToast(message: string) {
		toast = message;
		setTimeout(() => {
			if (toast === message) toast = null;
		}, 4000);
	}

	function handleStreamMessage(message: TableStreamMessage) {
		streamEvents = [...streamEvents, message];
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
				action: string;
				status?: string;
				reason?: string;
				placeEntityId?: string;
			};
			if (payload.status === 'drafting') showToast(`Drafting an NPC…`);
			else if (payload.status === 'failed')
				showToast(`${payload.action} failed: ${payload.reason ?? 'unknown reason'}`);
			npcPending = payload.status === 'drafting';
		} else if (message.type === 'proposal') {
			const payload = message.data as ProposalSummary;
			proposals = [...proposals, payload];
			npcPending = false;
			showToast(
				payload.drafted === 'scaffold'
					? `Saved as a proposal (${payload.via}, no model - a scaffold to fill in)`
					: `Saved as a proposal (${payload.via})`
			);
		} else if (message.type === 'reveal') {
			const payload = message.data as { name: string };
			showToast(`${payload.name} marked as revealed`);
		} else if (message.type === 'session-ended') {
			sessionEndedBanner = `Session ended, ${proposals.length} proposal${proposals.length === 1 ? '' : 's'} arrived while you played.`;
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
		const response = await fetch(`/u/${data.universeSlug}/table/context`, {
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
	}

	async function fireAction(kind: 'npc' | 'location' | 'reveal', label?: string) {
		if (!context?.placeEntityId) return;
		if (kind === 'npc') npcPending = true;
		const response = await fetch(`/u/${data.universeSlug}/table/actions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ kind, label })
		});
		if (!response.ok) {
			npcPending = false;
			const body = (await response.json().catch(() => null)) as { message?: string } | null;
			showToast(body?.message ?? `${kind} failed`);
			return;
		}
		if (kind === 'location') showToast('Saved as a proposal (+ create a child location)');
		if (kind === 'reveal') await invalidateAll();
	}

	async function submitNote(input: { targetEntityId: string; note: string }) {
		const response = await fetch(`/u/${data.universeSlug}/table/notes`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(input)
		});
		showNoteForm = false;
		if (!response.ok) showToast('Could not save that note');
	}

	async function exitTableMode() {
		await fetch(`/u/${data.universeSlug}/table/end`, { method: 'POST' });
		sessionEndedBanner = `Session ended. ${proposals.length} proposal${proposals.length === 1 ? '' : 's'} arrived while you played.`;
		context = null;
		pins = [];
		await invalidateAll();
	}

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

<ContextStrip
	{context}
	universeName={data.universeName}
	{pinnedElapsedMs}
	proposalCount={proposals.length}
	onChangeContext={() => (showDeclareForm = !showDeclareForm)}
	onExit={exitTableMode}
/>

<main class="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-5">
	{#if sessionEndedBanner}
		<div class="rounded-md border border-line-2 bg-panel-2 p-3 text-sm text-ink-2">
			{sessionEndedBanner}
		</div>
	{/if}

	{#if toast}
		<div
			class="rounded-md border border-line-2 bg-panel-2 px-3 py-2 text-sm text-ink-2"
			role="status"
		>
			{toast}
		</div>
	{/if}

	{#if showDeclareForm}
		<DeclareContext
			places={data.places}
			sessions={data.sessions}
			initialPlaceId={context?.placeEntityId ?? null}
			initialSessionId={context?.sessionEntityId ?? null}
			onDeclare={declareContext}
			onCancel={() => (showDeclareForm = false)}
		/>
	{/if}

	{#if !context?.placeEntityId}
		<p class="text-sm text-muted">Declare a place to pin its main characters and relations.</p>
	{:else}
		<section class="hidden md:block" class:!block={activeTab === 'here'}>
			<h2 class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Pinned</h2>
			<PinnedCards {pins} universeSlug={data.universeSlug} />
		</section>

		<section class="hidden md:block" class:!block={activeTab === 'here' || activeTab === 'actions'}>
			<h2 class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Quick actions</h2>
			<QuickActionDock
				canReveal={context.sessionEntityId !== null}
				{npcPending}
				onMarkRevealed={() => fireAction('reveal')}
				onNpcHere={() => fireAction('npc')}
				onCreateLocation={(label) => fireAction('location', label)}
				onJotNote={() => (showNoteForm = true)}
			/>
			<div class="mt-3">
				<AmbientPlayer universeSlug={data.universeSlug} userId={data.userId} pack={ambientPack} />
			</div>
		</section>

		{#if showNoteForm}
			<section class="hidden md:block" class:!block={activeTab === 'actions'}>
				<QuickNoteForm
					targets={noteTargets}
					onSubmit={submitNote}
					onCancel={() => (showNoteForm = false)}
				/>
			</section>
		{/if}

		<section class="hidden md:block" class:!block={activeTab === 'here'}>
			<InstantSearch universeSlug={data.universeSlug} />
		</section>

		<section class="hidden md:block" class:!block={activeTab === 'ask'}>
			<h2 class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Ask</h2>
			<p class="text-sm text-muted">
				Ask is not built in this wave. {#if paletteShortcut}Once it ships, it opens from the command
					palette ({formatShortcut(paletteShortcut)}).{/if}
			</p>
		</section>

		<section class="hidden md:block" class:!block={activeTab === 'queue'}>
			<h2 class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
				Proposals from this session
			</h2>
			{#if proposals.length === 0}
				<p class="text-sm text-muted">
					Nothing yet. Fire a quick action or jot a note to see one land here.
				</p>
			{:else}
				<ul class="flex flex-col gap-1.5">
					{#each proposals as proposal (proposal.proposalId)}
						<li class="rounded-md border border-line bg-panel p-2.5 text-sm">
							<span class="rounded-full bg-ai-bg px-1.5 py-0.5 font-mono text-[10px] text-ai">
								proposal &middot; {proposal.kind}
							</span>
							<span class="ml-2 text-muted">from: {proposal.via}</span>
							{#if proposal.drafted === 'model'}
								<span
									class="ml-2 rounded-full bg-ai-bg px-1.5 py-0.5 font-mono text-[10px] text-ai"
									title="A model drafted this - still unapplied until you accept it in Proposals."
								>
									AI-drafted
								</span>
							{:else if proposal.drafted === 'scaffold'}
								<span
									class="ml-2 rounded-full bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-muted"
									title={proposal.unavailableReason ?? 'No model was available for this draft.'}
								>
									scaffold, no model
								</span>
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
									AI unavailable: {proposal.unavailableReason}
								</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	<p class="text-[11px] text-muted">
		stream: {streamEvents.length} event{streamEvents.length === 1 ? '' : 's'} received{streamEvents.length >
		0
			? ` · last id ${streamEvents[streamEvents.length - 1]?.id}`
			: ''}
	</p>
</main>

<PhoneTabBar
	active={activeTab}
	queueCount={proposals.length}
	onSelect={(tab) => (activeTab = tab)}
/>
