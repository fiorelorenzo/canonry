<script lang="ts">
	/**
	 * Ask (issues #53/#60, C8 = B amended, G5 = A amended): the palette launches the flow
	 * (Sidebar's "Ask the Loremaster" button today, standing in for the full command
	 * palette issue #75 builds), the answer expands in place on this route, and clicking a
	 * source opens a side panel holding that entry - no popover, no navigation away, the
	 * answer stays readable beside it.
	 *
	 * Sources are rendered from the moment the `sources` SSE event arrives, before any
	 * answer text exists - `askAnswer` is empty until the first `token` event, but
	 * `askSources` is never empty-while-loading in a way that could read as "no evidence
	 * for this answer", satisfying guardrail 3 even mid-stream.
	 */
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type DetailLevel = '1_line' | 'short' | 'normal' | 'detailed' | 'full';
	const LEVELS: Array<{ id: DetailLevel; label: string }> = [
		{ id: '1_line', label: '1 line' },
		{ id: 'short', label: 'Short' },
		{ id: 'normal', label: 'Normal' },
		{ id: 'detailed', label: 'Detailed' },
		{ id: 'full', label: 'Full' }
	];

	interface OwnCanonSource {
		kind: 'own_canon';
		entityId: string;
		entityName: string;
		entitySlug: string;
		statement: string;
		score: number;
	}
	interface IndexedSource {
		kind: 'indexed';
		dataSourceId: string;
		pageTitle: string;
		breadcrumb: string;
		url: string;
		text: string;
		attribution: string;
		licence: string | null;
		licenceUrl: string | null;
		score: number;
	}
	type AskSource = OwnCanonSource | IndexedSource;

	let question = $state('');
	let detailLevel = $state<DetailLevel>('normal');
	let asking = $state(false);
	let generated = $state<boolean | null>(null);
	let askAnswer = $state('');
	let askSources = $state<AskSource[]>([]);
	let followUps = $state<string[]>([]);
	let askError = $state<string | null>(null);

	interface PanelEntry {
		name: string;
		type: string;
		body: string;
	}
	let panelEntry = $state<PanelEntry | null>(null);
	let panelLoading = $state(false);

	async function openPanel(source: OwnCanonSource) {
		panelLoading = true;
		panelEntry = null;
		try {
			const res = await fetch(`/u/${data.universeSlug}/ask/entry/${source.entitySlug}`);
			if (res.ok) panelEntry = (await res.json()) as PanelEntry;
		} finally {
			panelLoading = false;
		}
	}

	function closePanel() {
		panelEntry = null;
	}

	async function ask(nextQuestion?: string) {
		const q = (nextQuestion ?? question).trim();
		if (q.length === 0 || asking) return;
		question = q;
		asking = true;
		generated = null;
		askAnswer = '';
		askSources = [];
		followUps = [];
		askError = null;
		panelEntry = null;

		const res = await fetch(`/u/${data.universeSlug}/ask`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ question: q, detailLevel })
		});
		if (!res.ok || !res.body) {
			askError = 'Ask failed.';
			asking = false;
			return;
		}

		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const events = buffer.split('\n\n');
			buffer = events.pop() ?? '';
			for (const raw of events) {
				const lines = raw.split('\n');
				const eventLine = lines.find((l) => l.startsWith('event: '));
				const dataLine = lines.find((l) => l.startsWith('data: '));
				if (!eventLine || !dataLine) continue;
				const eventName = eventLine.slice('event: '.length);
				const payload: unknown = JSON.parse(dataLine.slice('data: '.length));
				if (eventName === 'sources' && payload && typeof payload === 'object') {
					const p = payload as { sources: AskSource[]; followUps: string[] };
					askSources = p.sources;
					followUps = p.followUps;
				} else if (eventName === 'token' && payload && typeof payload === 'object') {
					askAnswer += (payload as { delta: string }).delta;
				} else if (eventName === 'done' && payload && typeof payload === 'object') {
					const p = payload as { generated: boolean };
					generated = p.generated;
				} else if (eventName === 'error' && payload && typeof payload === 'object') {
					askError = (payload as { message: string }).message;
				}
			}
		}
		asking = false;
	}

	async function askAtLevel(level: DetailLevel) {
		detailLevel = level;
		if (askAnswer.length > 0 || askSources.length > 0) await ask(question);
	}
</script>

<svelte:head>
	<title>Ask — {data.current.name} — Canonry</title>
</svelte:head>

<div class="flex h-screen">
	<div
		class="flex-1 overflow-y-auto px-8 py-8"
		class:max-w-2xl={panelEntry !== null || panelLoading}
	>
		<p class="crumb text-xs tracking-wide text-muted uppercase">Ask · {data.current.name}</p>

		<form
			class="mt-3 flex items-center gap-2 rounded-lg border border-line-2 bg-panel px-3 py-2"
			onsubmit={(e) => {
				e.preventDefault();
				void ask();
			}}
		>
			<input
				class="flex-1 border-0 bg-transparent text-sm text-ink outline-none"
				placeholder="Ask about this universe…"
				bind:value={question}
			/>
			<button
				type="submit"
				class="rounded-md bg-accent px-3 py-1 text-sm text-paper"
				disabled={asking}
			>
				{asking ? 'Asking…' : 'Ask'}
			</button>
		</form>

		<div class="mt-2 flex flex-wrap gap-1">
			{#each LEVELS as level (level.id)}
				<button
					type="button"
					class="rounded-md border border-line px-2 py-1 text-xs"
					class:bg-accent-bg={detailLevel === level.id}
					class:text-ink={detailLevel === level.id}
					class:text-ink-2={detailLevel !== level.id}
					onclick={() => askAtLevel(level.id)}
				>
					{level.label}
				</button>
			{/each}
		</div>

		{#if askError}
			<p class="mt-4 rounded-md border border-danger-bg bg-danger-bg px-3 py-2 text-sm text-danger">
				{askError}
			</p>
		{/if}

		{#if generated === false}
			<p class="mt-3 rounded-md border border-warn-bg bg-warn-bg px-3 py-2 text-xs text-warn">
				Generation is switched off for this universe: this reads your own canon directly, at no
				cost, rather than a model-written answer.
			</p>
		{/if}

		{#if askAnswer.length > 0 || asking}
			<p class="mt-4 max-w-measure text-sm leading-relaxed text-ink">
				{askAnswer}{#if asking}<span class="ai-note text-ai"> …</span>{/if}
			</p>
		{/if}

		{#if askSources.length > 0}
			<div class="mt-4 flex flex-col gap-1.5">
				{#each askSources as source, i (source.kind === 'own_canon' ? source.entityId : `${source.dataSourceId}-${i}`)}
					{#if source.kind === 'own_canon'}
						<button
							type="button"
							class="src clickable rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-left text-xs"
							onclick={() => openPanel(source)}
						>
							<b class="text-ink underline decoration-dotted underline-offset-2"
								>{source.entityName}</b
							>
							<span class="text-muted"> · your canon</span>
							<span class="mt-0.5 block text-ink-2">"{source.statement}"</span>
						</button>
					{:else}
						<div class="src derived rounded-lg border border-ai-line bg-ai-bg px-2.5 py-2 text-xs">
							<span class="badge rounded-full bg-ai px-1.5 py-0.5 text-[10px] text-paper"
								>indexed</span
							>
							<b class="text-ink">{source.pageTitle}</b>
							<a href={source.url} target="_blank" rel="noreferrer" class="text-ink-2 underline"
								>↗</a
							>
							<span class="lic mt-0.5 block font-mono text-[11px] text-muted">
								{source.attribution}{#if source.licence}
									· {source.licence}{/if}
							</span>
						</div>
					{/if}
				{/each}
			</div>
		{/if}

		{#if followUps.length > 0}
			<div class="mt-3 flex flex-wrap gap-1.5">
				{#each followUps as followUp (followUp)}
					<button
						type="button"
						class="rounded-md border border-line px-2 py-1 text-xs text-ink-2 hover:bg-panel-2"
						onclick={() => ask(followUp)}
					>
						{followUp}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	{#if panelLoading || panelEntry}
		<div class="w-96 flex-none overflow-y-auto border-l border-line bg-panel p-6">
			<button type="button" class="text-xs text-muted hover:text-ink" onclick={closePanel}
				>Close ✕</button
			>
			{#if panelLoading}
				<p class="mt-3 text-sm text-muted">Loading…</p>
			{:else if panelEntry}
				<div class="kicker mt-3">
					<span class="text-xs tracking-wide text-muted uppercase">{panelEntry.type}</span>
				</div>
				<h1 class="mt-1 font-serif text-lg text-ink">{panelEntry.name}</h1>
				<div class="prose mt-3 text-sm whitespace-pre-wrap text-ink-2">{panelEntry.body}</div>
			{/if}
		</div>
	{/if}
</div>
