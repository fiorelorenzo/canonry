<script lang="ts">
	/**
	 * Decision C10 = B, wording from H1: the switch is named for what it stops
	 * ("Stop writing"), not for AI as a category, because reading keeps working while it
	 * is on. Decision A2 = A: precedence is visible, not a click away - a derived
	 * universe's supersede declarations list here, with the source page struck through.
	 * Decision K1 (DECISIONS.md "Round six"): a card here links to `settings/relations`,
	 * issue #192's catalogue, rather than inlining a page's worth of tables and dialogs.
	 * Decision N1 (DECISIONS.md "Round nine"): the propagation cap control, in the same
	 * visual language as the writing switch above it - a number, or "no limit" turns it
	 * off entirely. A disabled number input is never submitted, so the server only ever
	 * sees `cap` when a real number applies.
	 *
	 * Issue #286, decision O4 = B: both fields in the precedence form are drawn from the
	 * GM's own data, so both are the combobox with search. The entry field is the reason
	 * the third control exists at all: it offers every entity in a derived universe with
	 * no filter of any kind (`+page.server.ts`'s own `universeEntities`), which is 61
	 * rows in the sample world and unbounded in a real one.
	 *
	 * **Without JavaScript this form keeps working.** A popover cannot open without it,
	 * so each combobox is marked `data-js-only` and paired with `ui/native-fallback`,
	 * which puts a real `<select>` inside `<noscript>`. Letting a hidden input post its
	 * default instead would have declared precedence over whichever entry happened to
	 * sort first, which is a wrong write rather than a degraded one.
	 */
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import { Combobox } from '$lib/components/ui/combobox';
	import { NativeFallback } from '$lib/components/ui/native-fallback';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const t = $derived(messages(data.locale).universe.settings);
	const tRelations = $derived(t.relations);
	const tControls = $derived(messages(data.locale).controls);

	const entityOptions = $derived(
		data.universeEntities.map((entity) => ({ value: entity.id, label: entity.name }))
	);
	const baseSourceOptions = $derived(
		data.baseDataSources.map((source) => ({ value: source.id, label: source.name }))
	);
	let supersedeEntityId = $state<string | null>(null);
	let supersedeSourceId = $state<string | null>(null);

	let aiEnabled = $derived(form?.aiEnabled ?? data.aiEnabled);

	// Annotated, and `undefined` explicitly excluded, because `ActionData` is a union over
	// every action on this page: `'propagationCap' in form` narrows to the member that has
	// the key but still admits `undefined` for it, which then leaks into `capInput` and the
	// number input's own `number` prop.
	let propagationCap = $derived<number | null>(
		form && 'propagationCap' in form && form.propagationCap !== undefined
			? form.propagationCap
			: data.propagationCap
	);
	let noLimit = $state(propagationCap === null);
	// 25 as a starting point mirrors packages/db/src/schema/universe.ts's own column
	// default - not authoritative here, it is only what the number field shows if a GM
	// switches off "no limit" without ever having typed a number of their own.
	let capInput = $state(propagationCap ?? 25);
	$effect(() => {
		noLimit = propagationCap === null;
		if (propagationCap !== null) capInput = propagationCap;
	});
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

	<section class="mt-8 rounded-lg border border-line bg-panel p-4">
		<h2 class="text-sm font-semibold text-ink">{t.propagationCap.heading}</h2>
		<p class="mt-1 max-w-measure text-sm text-ink-2">
			{t.propagationCap.description(data.current.name)}
		</p>
		<form method="POST" action="?/setPropagationCap" class="mt-3 flex flex-wrap items-center gap-3">
			<label class="flex items-center gap-2 text-sm text-ink-2">
				{t.propagationCap.capLabel}
				<input
					type="number"
					name="cap"
					min="1"
					step="1"
					bind:value={capInput}
					disabled={noLimit}
					class="h-9 w-20 rounded-md border border-line-2 bg-panel px-2 text-sm text-ink disabled:opacity-50"
				/>
			</label>
			<label class="flex items-center gap-2 text-sm text-ink-2">
				<input type="checkbox" name="noLimit" value="true" bind:checked={noLimit} class="h-4 w-4" />
				{t.propagationCap.noLimitLabel}
			</label>
			<Button type="submit" variant="secondary" class="w-fit">
				{t.propagationCap.save}
			</Button>
			{#if form?.message}
				<p class="w-full text-sm text-danger">{form.message}</p>
			{/if}
		</form>
		<p class="mt-3 text-xs text-muted">
			{#if propagationCap === null}
				{t.propagationCap.noLimitNotice}
			{:else}
				{@const notice = t.propagationCap.capNotice(propagationCap)}
				{notice.prefix}<b class="text-ink-2">{propagationCap}</b>{notice.suffix}
			{/if}
		</p>
	</section>

	<section class="mt-8 rounded-lg border border-line bg-panel p-4">
		<div class="flex items-center justify-between gap-4">
			<div>
				<h2 class="text-sm font-semibold text-ink">{tRelations.cardHeading}</h2>
				<p class="mt-1 max-w-measure text-sm text-ink-2">
					{tRelations.cardDescription(data.current.name)}
				</p>
				<p class="mt-1 text-xs text-muted">{tRelations.cardCountOwn(data.ownRelationTypeCount)}</p>
			</div>
			<Button href={resolve(`/w/${data.current.slug}/settings/relations`)} variant="secondary">
				{tRelations.manageLink}
			</Button>
		</div>
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
				<div class="flex flex-col gap-1 text-sm text-ink-2">
					<label for="supersede-entity">{t.precedence.entryLabel}</label>
					<div data-js-only>
						<Combobox
							id="supersede-entity"
							bind:value={supersedeEntityId}
							options={entityOptions}
							placeholder={t.precedence.entryLabel}
							searchPlaceholder={tControls.search}
							emptyText={tControls.noMatch}
						/>
					</div>
					<NativeFallback
						name="entityId"
						value={supersedeEntityId}
						options={entityOptions}
						required
						label={t.precedence.entryLabel}
					/>
				</div>
				<div class="flex flex-col gap-1 text-sm text-ink-2">
					<label for="supersede-source">{t.precedence.baseSourceLabel}</label>
					<div data-js-only>
						<Combobox
							id="supersede-source"
							bind:value={supersedeSourceId}
							options={baseSourceOptions}
							placeholder={t.precedence.baseSourceLabel}
							searchPlaceholder={tControls.search}
							emptyText={tControls.noMatch}
						/>
					</div>
					<NativeFallback
						name="dataSourceId"
						value={supersedeSourceId}
						options={baseSourceOptions}
						required
						label={t.precedence.baseSourceLabel}
					/>
				</div>
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
