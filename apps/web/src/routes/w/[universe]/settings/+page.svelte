<script lang="ts">
	/**
	 * Decision C10 = B, wording from H1: the switch is named for what it stops
	 * ("Stop writing"), not for AI as a category, because reading keeps working while it
	 * is on. Decision A2 = A: precedence is visible, not a click away - a derived
	 * universe's supersede declarations list here, with the source page struck through.
	 */
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const t = $derived(messages(data.locale).universe.settings);

	let aiEnabled = $derived(form?.aiEnabled ?? data.aiEnabled);
</script>

<svelte:head><title>{t.headTitle(data.current.name)}</title></svelte:head>

<div class="mx-auto max-w-2xl px-8 py-10">
	<h1 class="text-2xl font-semibold text-ink">{t.heading}</h1>
	<p class="mt-2 max-w-measure text-sm text-ink-2">
		{t.introBefore(data.current.name)}<a
			class="text-accent hover:underline"
			href={resolve('/settings/appearance')}>{t.appearanceLink}</a
		>{t.introAnd}<a
			class="text-accent hover:underline"
			href={resolve(`/settings/export/${data.current.slug}`)}>{t.exportLink}</a
		>{t.introAfter}
	</p>

	<section class="mt-8 rounded-lg border border-line bg-panel p-4">
		<div class="flex items-center justify-between gap-4">
			<div>
				<h2 class="text-sm font-semibold text-ink">{t.aiToggle.heading}</h2>
				<p class="mt-1 max-w-measure text-sm text-ink-2">
					{t.aiToggle.description(data.current.name)}
				</p>
			</div>
			<form method="POST" action="?/setAiEnabled">
				<input type="hidden" name="enabled" value={(!aiEnabled).toString()} />
				<Button
					type="submit"
					variant="secondary"
					class={aiEnabled ? 'border-line-2 text-ink-2' : 'border-ai-line bg-ai-bg text-ai'}
				>
					{aiEnabled ? t.aiToggle.stopWriting : t.aiToggle.resumeWriting}
				</Button>
			</form>
		</div>
		{#if !aiEnabled}
			<p class="mt-3 rounded-md border border-ai-line bg-ai-bg px-3 py-2 text-xs text-ai">
				{t.aiToggle.offNotice(data.current.name)}
			</p>
		{/if}
	</section>

	{#if data.isDerived}
		<section class="mt-8 rounded-lg border border-line bg-panel p-4">
			<h2 class="text-sm font-semibold text-ink">{t.precedence.heading}</h2>
			<p class="mt-1 max-w-measure text-sm text-ink-2">
				{t.precedence.description(data.current.name)}
			</p>

			{#if data.supersedes.length === 0}
				<p class="mt-3 text-sm text-muted">{t.precedence.empty}</p>
			{:else}
				<ul class="mt-3 flex flex-col divide-y divide-line">
					{#each data.supersedes as row (row.id)}
						<li class="flex items-center gap-3 py-2 text-sm">
							<span class="flex-1 text-ink-2 line-through decoration-line-2">
								{row.dataSourceName} &middot; {row.sourceUrl}
							</span>
							<Badge variant="secondary" class="text-muted uppercase">
								{t.precedence.supersededBadge}
							</Badge>
							<a
								href={resolve(`/w/${data.current.slug}/e/${row.entitySlug}`)}
								class="text-accent hover:underline"
							>
								{row.entityName}
							</a>
							<form method="POST" action="?/removeSupersede">
								<input type="hidden" name="id" value={row.id} />
								<Button
									type="submit"
									variant="link"
									size="sm"
									class="h-auto p-0 text-xs text-muted hover:text-danger"
								>
									{t.precedence.remove}
								</Button>
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
					{t.precedence.declareHeading}
				</h3>
				<label class="flex flex-col gap-1 text-sm text-ink-2">
					{t.precedence.entryLabel}
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
					{t.precedence.baseSourceLabel}
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
					{t.precedence.sourceUrlLabel}
					<Input name="sourceUrl" required />
				</label>
				<label class="flex flex-col gap-1 text-sm text-ink-2">
					{t.precedence.noteLabel} <span class="text-muted">{t.precedence.optional}</span>
					<Input name="note" />
				</label>
				{#if form?.message}
					<p class="text-sm text-danger">{form.message}</p>
				{/if}
				<Button type="submit" variant="secondary" class="w-fit">
					{t.precedence.submit}
				</Button>
			</form>
		</section>
	{/if}
</div>
