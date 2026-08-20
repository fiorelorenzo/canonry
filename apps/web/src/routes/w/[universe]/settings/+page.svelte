<script lang="ts">
	/**
	 * Issue #406 (S1, DECISIONS.md "Round fourteen"): the universe's own settings
	 * page takes the same two-pane shell issue #143 (I6 = B) built for the account -
	 * a rail on the left, one content pane on the right - via `SettingsShell`
	 * (`$lib/components/settings/SettingsShell.svelte`), extracted from `routes/
	 * settings/+layout.svelte` rather than grown a second time here. Three named
	 * groups replace the seven ungrouped cards this page used to be, in this order:
	 * Images (the image style form, untouched - #407 lands a picker on top of it),
	 * The Loremaster (the voice, the writing switch and the propagation cap - all
	 * three about how much the copilot may do), and Canon (the relation catalogue
	 * link and precedence for a derived world). The setup checklist card is gone -
	 * `railItems` below turns the same `universeSetupItems()` payload the shell row
	 * counts (`+page.server.ts`'s own `setupItems`) into a small mark on whichever
	 * rail row owns the unset item, which is where somebody looking for what is
	 * unfinished will look, rather than a fourth thing to read above the groups that
	 * actually hold the settings.
	 *
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
	import CheckIcon from '@lucide/svelte/icons/check';
	import { messages } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import { Combobox } from '$lib/components/ui/combobox';
	import { NativeFallback } from '$lib/components/ui/native-fallback';
	import { PageHeader } from '$lib/components/ui/page-header';
	import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
	import { Textarea } from '$lib/components/ui/textarea';
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

	// Issue #378, decision R3: same "read the last submission, fall back to the loaded
	// row" shape as `aiEnabled`/`propagationCap` above - a successful save shows what was
	// just written without a full reload, a failed one leaves whatever the GM typed
	// alone (the action never returns these keys on failure, so the `in`/`undefined`
	// checks fall through to `data` exactly as they do for the two older fields).
	let imageStyleName = $derived(
		form && 'imageStyleName' in form && form.imageStyleName !== undefined
			? form.imageStyleName
			: data.imageStyleName
	);
	let imageStyleModifier = $derived(
		form && 'imageStyleModifier' in form && form.imageStyleModifier !== undefined
			? form.imageStyleModifier
			: data.imageStyleModifier
	);
	let imageStyleError = $derived(
		form && 'imageStyleError' in form ? form.imageStyleError : undefined
	);
	// Issue #407, decision S2: a preset pick from `?/selectImageStylePreset` returns
	// `selectedPresetId` on success - read here so the grid updates the instant the
	// no-JS full-page reload lands, exactly the "read the last submission, fall back to
	// the loaded row" shape the fields above already use. `?/setImageStyle`'s own
	// success shape carries no such key, so a custom-style save always falls through to
	// `data.currentImageStyleId`, which a full reload has already made fresh.
	let currentImageStyleId = $derived(
		form && 'selectedPresetId' in form && form.selectedPresetId !== undefined
			? form.selectedPresetId
			: data.currentImageStyleId
	);
	// A universe's own custom row is "whatever image_style_id points at that is not one
	// of the six presets" - null (nothing chosen yet) reads as false here on purpose, so
	// a brand new universe opens with no card selected and the custom disclosure closed.
	let isCustomActive = $derived(
		currentImageStyleId !== null &&
			!data.imageStylePresets.some((preset) => preset.id === currentImageStyleId)
	);
	// svelte-ignore state_referenced_locally
	let customOpen = $state(isCustomActive);
	$effect(() => {
		if (isCustomActive) customOpen = true;
	});
	let loremasterDescription = $derived(
		form && 'loremasterDescription' in form && form.loremasterDescription !== undefined
			? form.loremasterDescription
			: data.loremasterDescription
	);
	let loremasterVoiceError = $derived(
		form && 'loremasterVoiceError' in form ? form.loremasterVoiceError : undefined
	);

	// Issue #406 (S1): the rail's own rows, one per group, in fixed order - each row's
	// `unset` flag reads the same `universeSetupItems()` payload the old checklist card
	// rendered as a list (issue #379, decision R4), filtered down to the one item (if
	// any) that group owns. Canon owns no checklist item today, so its row never marks.
	const railItems = $derived([
		{
			id: 'images',
			href: '#group-images',
			label: t.groups.images,
			unset: data.setupItems.some((item) => item.id === 'imageStyle' && !item.done)
		},
		{
			id: 'loremaster',
			href: '#group-loremaster',
			label: t.groups.loremaster,
			unset: data.setupItems.some((item) => item.id === 'loremasterVoice' && !item.done)
		},
		{ id: 'canon', href: '#group-canon', label: t.groups.canon, unset: false }
	]);
</script>

<svelte:head><title>{t.headTitle(data.current.name)}</title></svelte:head>

<SettingsShell>
	{#snippet rail()}
		<!-- eslint-disable svelte/no-navigation-without-resolve -- same-page fragment
		     anchors into the groups below, not a route resolve() can rewrite. -->
		<nav aria-label={t.rail.ariaLabel} class="flex shrink-0 flex-col gap-0.5 lg:w-48">
			{#each railItems as item (item.id)}
				<a
					href={item.href}
					class="flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm text-ink-2 hover:bg-panel-2"
				>
					<span>{item.label}</span>
					{#if item.unset}
						<span
							class="shrink-0 rounded-full bg-warn-bg px-1.5 py-0.5 text-[10px] font-medium text-warn"
						>
							{t.rail.incompleteMark}
						</span>
					{/if}
				</a>
			{/each}
		</nav>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	{/snippet}

	<PageHeader title={t.heading} />
	<p class="mt-4 max-w-measure text-sm text-ink-2">
		{t.introBefore(data.current.name)}<a
			class="text-accent hover:underline"
			href={resolve('/settings/appearance')}>{t.appearanceLink}</a
		>{t.introAnd}<a
			class="text-accent hover:underline"
			href={resolve(`/settings/export/${data.current.slug}`)}>{t.exportLink}</a
		>{t.introAfter}
	</p>

	<section id="group-images" class="mt-8">
		<h2 class="text-lg font-semibold text-ink">{t.groups.images}</h2>
		<div class="mt-3 rounded-lg border border-line bg-panel p-4">
			<h3 class="text-sm font-semibold text-ink">{t.imageStyle.heading}</h3>
			<p class="mt-1 max-w-measure text-sm text-ink-2">
				{t.imageStyle.description(data.current.name)}
			</p>

			<!-- Issue #407, decision S2: a grid of cards - example, name, description,
			     selected state - replacing the name-plus-prompt form that asked a GM to
			     imagine what a sentence of prompt would do to an image. Picking a preset
			     posts `?/selectImageStylePreset`, which only ever points universe.image_style_id
			     at the shipped row (queries/media.ts's selectUniverseImageStylePreset) - it
			     never copies the preset's prompt modifier anywhere, so an improved preset
			     improves every world that chose it. The picker form is `class="contents"` so
			     its six card labels lay out as direct children of the grid below, sibling to
			     the "Custom style" disclosure rather than nesting one form inside another
			     (invalid HTML) - the form itself still submits normally either way. -->
			<div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
				<form method="POST" action="?/selectImageStylePreset" class="contents">
					{#each data.imageStylePresets as preset (preset.id)}
						<label
							class="flex cursor-pointer flex-col overflow-hidden rounded-lg border border-line text-left transition-colors has-checked:border-accent has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
						>
							<input
								type="radio"
								name="presetId"
								value={preset.id}
								checked={currentImageStyleId === preset.id}
								class="sr-only"
								onchange={(event) => {
									event.currentTarget.form?.requestSubmit();
								}}
							/>
							<img
								src={preset.examplePath}
								alt=""
								loading="lazy"
								class="aspect-square w-full object-cover"
							/>
							<span class="flex flex-1 flex-col gap-0.5 px-2 py-2">
								<span class="flex items-center gap-1 text-sm font-medium text-ink">
									{preset.name}
									{#if currentImageStyleId === preset.id}
										<CheckIcon class="size-3.5 shrink-0 text-accent" aria-hidden="true" />
										<span class="sr-only">{t.imageStyle.selectedLabel}</span>
									{/if}
								</span>
								<span class="text-xs text-ink-2">{preset.description}</span>
							</span>
						</label>
					{/each}
					<noscript>
						<Button type="submit" variant="secondary" size="sm" class="col-span-full w-fit">
							{tControls.apply}
						</Button>
					</noscript>
				</form>

				<details
					class="flex flex-col overflow-hidden rounded-lg border text-left"
					class:border-accent={isCustomActive}
					class:border-line={!isCustomActive}
					bind:open={customOpen}
				>
					<summary
						class="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2.5 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden"
					>
						<span
							class="text-[10px] text-muted transition-transform"
							class:rotate-90={customOpen}
							aria-hidden="true">&#9656;</span
						>
						{t.imageStyle.customCard.label}
						{#if isCustomActive}
							<CheckIcon class="size-3.5 shrink-0 text-accent" aria-hidden="true" />
							<span class="sr-only">{t.imageStyle.selectedLabel}</span>
						{/if}
					</summary>
					<div class="border-t border-line px-3 py-3">
						<p class="text-xs text-ink-2">{t.imageStyle.customCard.hint}</p>
						<form method="POST" action="?/setImageStyle" class="mt-3 flex flex-col gap-3">
							<label class="flex flex-col gap-1 text-sm text-ink-2">
								{t.imageStyle.nameLabel}
								<Input name="name" value={imageStyleName} required />
							</label>
							<label class="flex flex-col gap-1 text-sm text-ink-2">
								{t.imageStyle.promptModifierLabel}
								<Textarea name="promptModifier" rows={2} value={imageStyleModifier} required />
							</label>
							<Button type="submit" variant="secondary" class="w-fit">
								{t.imageStyle.save}
							</Button>
						</form>
					</div>
				</details>
			</div>
			{#if imageStyleError}
				<p class="mt-2 text-sm text-danger">{imageStyleError}</p>
			{/if}
		</div>
	</section>

	<section id="group-loremaster" class="mt-8">
		<h2 class="text-lg font-semibold text-ink">{t.groups.loremaster}</h2>
		<div class="mt-3 flex flex-col gap-4">
			<div class="rounded-lg border border-line bg-panel p-4">
				<h3 class="text-sm font-semibold text-ink">{t.loremasterVoice.heading}</h3>
				<p class="mt-1 max-w-measure text-sm text-ink-2">
					{t.loremasterVoice.description(data.current.name)}
				</p>
				<form method="POST" action="?/setLoremasterVoice" class="mt-3 flex flex-col gap-2">
					<label class="flex flex-col gap-1 text-sm text-ink-2" for="loremaster-voice">
						{t.loremasterVoice.textareaLabel}
					</label>
					<!-- 500 mirrors `+page.server.ts`'s own LOREMASTER_DESCRIPTION_MAX_LENGTH - not
					     authoritative here, the client attribute is only a courtesy that stops most
					     GMs from ever seeing the server's rejection at all. -->
					<Textarea
						id="loremaster-voice"
						name="description"
						rows={3}
						maxlength={500}
						value={loremasterDescription}
					/>
					<p class="text-xs text-muted">{t.loremasterVoice.hint}</p>
					{#if loremasterVoiceError}
						<p class="text-sm text-danger">{loremasterVoiceError}</p>
					{/if}
					<Button type="submit" variant="secondary" class="w-fit">
						{t.loremasterVoice.save}
					</Button>
				</form>
			</div>

			<div class="rounded-lg border border-line bg-panel p-4">
				<div class="flex items-center justify-between gap-4">
					<div>
						<h3 class="text-sm font-semibold text-ink">{t.aiToggle.heading}</h3>
						<p class="mt-1 max-w-measure text-sm text-ink-2">
							{t.aiToggle.description(data.current.name)}
						</p>
					</div>
					<form method="POST" action="?/setAiEnabled">
						<input type="hidden" name="enabled" value={(!aiEnabled).toString()} />
						<Button
							type="submit"
							variant="secondary"
							class={aiEnabled
								? 'border-line-2 text-ink-2'
								: 'border-accent bg-accent-bg text-accent-ink'}
						>
							{aiEnabled ? t.aiToggle.stopWriting : t.aiToggle.resumeWriting}
						</Button>
					</form>
				</div>
				{#if !aiEnabled}
					<!-- Round eleven P2 (#344), and guardrail 4 more than P2: the copilot's hue is
					     the last thing that should announce that the copilot is off. This notice is
					     the theme's own panel and line. -->
					<p class="mt-3 rounded-md border border-line bg-panel-2 px-3 py-2 text-xs text-ink-2">
						{t.aiToggle.offNotice(data.current.name)}
					</p>
				{/if}
			</div>

			<div class="rounded-lg border border-line bg-panel p-4">
				<h3 class="text-sm font-semibold text-ink">{t.propagationCap.heading}</h3>
				<p class="mt-1 max-w-measure text-sm text-ink-2">
					{t.propagationCap.description(data.current.name)}
				</p>
				<form
					method="POST"
					action="?/setPropagationCap"
					class="mt-3 flex flex-wrap items-center gap-3"
				>
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
						<input
							type="checkbox"
							name="noLimit"
							value="true"
							bind:checked={noLimit}
							class="h-4 w-4"
						/>
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
			</div>
		</div>
	</section>

	<section id="group-canon" class="mt-8">
		<h2 class="text-lg font-semibold text-ink">{t.groups.canon}</h2>
		<div class="mt-3 flex flex-col gap-4">
			<div class="rounded-lg border border-line bg-panel p-4">
				<div class="flex items-center justify-between gap-4">
					<div>
						<h3 class="text-sm font-semibold text-ink">{tRelations.cardHeading}</h3>
						<p class="mt-1 max-w-measure text-sm text-ink-2">
							{tRelations.cardDescription(data.current.name)}
						</p>
						<p class="mt-1 text-xs text-muted">
							{tRelations.cardCountOwn(data.ownRelationTypeCount)}
						</p>
					</div>
					<Button href={resolve(`/w/${data.current.slug}/settings/relations`)} variant="secondary">
						{tRelations.manageLink}
					</Button>
				</div>
			</div>

			{#if data.isDerived}
				<div class="rounded-lg border border-line bg-panel p-4">
					<h3 class="text-sm font-semibold text-ink">{t.precedence.heading}</h3>
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
						<h4 class="text-xs font-semibold tracking-wide text-muted uppercase">
							{t.precedence.declareHeading}
						</h4>
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
				</div>
			{/if}
		</div>
	</section>
</SettingsShell>
