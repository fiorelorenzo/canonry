<script lang="ts">
	/**
	 * Decision C10 = B, wording from H1: the switch is named for what it stops
	 * ("Stop writing"), not for AI as a category, because reading keeps working while it
	 * is on. Decision A2 = A: precedence is visible, not a click away - a derived
	 * universe's supersede declarations list here, with the source page struck through.
	 */
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let aiEnabled = $derived(form?.aiEnabled ?? data.aiEnabled);
</script>

<svelte:head><title>Settings — {data.current.name}</title></svelte:head>

<div class="mx-auto max-w-2xl px-8 py-10">
	<h1 class="text-2xl font-semibold text-ink">Settings</h1>
	<p class="mt-2 max-w-measure text-sm text-ink-2">
		Universe settings for {data.current.name}. The colour theme and the account's export live in
		<a class="text-accent hover:underline" href={resolve('/settings/appearance')}>Appearance</a>
		and
		<a class="text-accent hover:underline" href={resolve(`/settings/export/${data.current.slug}`)}
			>Export</a
		>, which apply to the whole account rather than one universe.
	</p>

	<section class="mt-8 rounded-lg border border-line bg-panel p-4">
		<div class="flex items-center justify-between gap-4">
			<div>
				<h2 class="text-sm font-semibold text-ink">Loremaster writing</h2>
				<p class="mt-1 max-w-measure text-sm text-ink-2">
					Turns off new proposals, images, Ask and warm pre-computation for {data.current.name}.
					Search and mention suggestions keep reading this universe, and cost nothing.
				</p>
			</div>
			<form method="POST" action="?/setAiEnabled">
				<input type="hidden" name="enabled" value={(!aiEnabled).toString()} />
				<button
					type="submit"
					class="rounded-md border px-3 py-1.5 text-sm font-medium"
					class:border-line-2={aiEnabled}
					class:text-ink-2={aiEnabled}
					class:border-ai-line={!aiEnabled}
					class:bg-ai-bg={!aiEnabled}
					class:text-ai={!aiEnabled}
				>
					{aiEnabled ? 'Stop writing' : 'Resume writing'}
				</button>
			</form>
		</div>
		{#if !aiEnabled}
			<p class="mt-3 rounded-md border border-ai-line bg-ai-bg px-3 py-2 text-xs text-ai">
				Writing is off for {data.current.name}. Search and mention suggestions still spend from your
				included quota like any other request; they simply cost nothing, on or off.
			</p>
		{/if}
	</section>

	{#if data.isDerived}
		<section class="mt-8 rounded-lg border border-line bg-panel p-4">
			<h2 class="text-sm font-semibold text-ink">Precedence</h2>
			<p class="mt-1 max-w-measure text-sm text-ink-2">
				Your canon always wins. A source page an entry here supersedes is marked below, not deleted,
				and stops coming back from retrieval for {data.current.name} (SPEC.md §4.1).
			</p>

			{#if data.supersedes.length === 0}
				<p class="mt-3 text-sm text-muted">Nothing superseded yet.</p>
			{:else}
				<ul class="mt-3 flex flex-col divide-y divide-line">
					{#each data.supersedes as row (row.id)}
						<li class="flex items-center gap-3 py-2 text-sm">
							<span class="flex-1 text-ink-2 line-through decoration-line-2">
								{row.dataSourceName} &middot; {row.sourceUrl}
							</span>
							<span class="rounded-full bg-panel-2 px-2 py-0.5 text-xs text-muted uppercase">
								superseded
							</span>
							<a
								href={resolve(`/u/${data.current.slug}/e/${row.entitySlug}`)}
								class="text-accent hover:underline"
							>
								{row.entityName}
							</a>
							<form method="POST" action="?/removeSupersede">
								<input type="hidden" name="id" value={row.id} />
								<button type="submit" class="text-xs text-muted hover:text-danger">remove</button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}

			<form
				method="POST"
				action="?/addSupersede"
				class="mt-4 flex flex-col gap-3 border-t border-line pt-4"
			>
				<h3 class="text-xs font-semibold tracking-wide text-muted uppercase">
					Declare a supersede
				</h3>
				<label class="flex flex-col gap-1 text-sm text-ink-2">
					Your entry
					<select
						name="entityId"
						required
						class="rounded-md border border-line-2 bg-panel px-3 py-1.5 text-sm text-ink"
					>
						{#each data.universeEntities as entity (entity.id)}
							<option value={entity.id}>{entity.name}</option>
						{/each}
					</select>
				</label>
				<label class="flex flex-col gap-1 text-sm text-ink-2">
					Base source
					<select
						name="dataSourceId"
						required
						class="rounded-md border border-line-2 bg-panel px-3 py-1.5 text-sm text-ink"
					>
						{#each data.baseDataSources as source (source.id)}
							<option value={source.id}>{source.name}</option>
						{/each}
					</select>
				</label>
				<label class="flex flex-col gap-1 text-sm text-ink-2">
					Source page url
					<input
						name="sourceUrl"
						required
						class="rounded-md border border-line-2 bg-panel px-3 py-1.5 text-sm text-ink"
					/>
				</label>
				<label class="flex flex-col gap-1 text-sm text-ink-2">
					Note <span class="text-muted">(optional)</span>
					<input
						name="note"
						class="rounded-md border border-line-2 bg-panel px-3 py-1.5 text-sm text-ink"
					/>
				</label>
				{#if form?.message}
					<p class="text-sm text-danger">{form.message}</p>
				{/if}
				<button
					type="submit"
					class="w-fit rounded-md border border-line-2 px-3 py-1.5 text-sm text-ink-2 hover:bg-panel-2"
				>
					Supersede
				</button>
			</form>
		</section>
	{/if}
</div>
