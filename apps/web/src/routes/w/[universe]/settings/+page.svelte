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
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { AcceptMark } from '$lib/components/ui/accept-mark';
	import { messages } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import { Combobox } from '$lib/components/ui/combobox';
	import { NativeFallback } from '$lib/components/ui/native-fallback';
	import { Page } from '$lib/components/ui/page';
	import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
	import UniverseSettingsRail from '$lib/components/settings/UniverseSettingsRail.svelte';
	import { Textarea } from '$lib/components/ui/textarea';
	import { InlineLink } from '$lib/components/ui/link';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// #497 (V11): one flag per form on this page, since every one of the eight can be
	// mid-submit independently of the others.
	let applyingImageStylePreset = $state(false);
	let savingImageStyle = $state(false);
	let applyingNarrationStylePreset = $state(false);
	let savingNarrationStyle = $state(false);
	let settingAiEnabled = $state(false);
	let savingPropagationCap = $state(false);
	let removingSupersede = $state(false);
	let addingSupersede = $state(false);

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
	// Issue #451, decision U2: a preset pick from `?/selectNarrationStylePreset` returns
	// `selectedNarrationPresetId` on success, the same "read the last submission" shape
	// `currentImageStyleId` above uses.
	let currentNarrationStyleId = $derived(
		form && 'selectedNarrationPresetId' in form && form.selectedNarrationPresetId !== undefined
			? form.selectedNarrationPresetId
			: data.currentNarrationStyleId
	);
	// A universe's own custom row is "whatever narration_style_id points at that is not
	// one of the shipped presets" - same reasoning as `isCustomActive` above.
	let isCustomNarrationActive = $derived(
		currentNarrationStyleId !== null &&
			!data.narrationStylePresets.some((preset) => preset.id === currentNarrationStyleId)
	);
	// svelte-ignore state_referenced_locally
	let customNarrationOpen = $state(isCustomNarrationActive);
	$effect(() => {
		if (isCustomNarrationActive) customNarrationOpen = true;
	});
	let narrationStyleName = $derived(
		form && 'narrationStyleName' in form && form.narrationStyleName !== undefined
			? form.narrationStyleName
			: data.narrationStyleName
	);
	let narrationStylePromptClause = $derived(
		form && 'narrationStylePromptClause' in form && form.narrationStylePromptClause !== undefined
			? form.narrationStylePromptClause
			: data.narrationStylePromptClause
	);
	let narrationStyleError = $derived(
		form && 'narrationStyleError' in form ? form.narrationStyleError : undefined
	);

	// Issue #406 (S1): the rail's own rows, one per group, in fixed order - each row's
	// `unset` flag reads the same `universeSetupItems()` payload the old checklist card
	// rendered as a list (issue #379, decision R4), filtered down to the one item (if
	// any) that group owns. Canon owns no checklist item today, so its row never marks.
	const railItems = $derived([
		{
			id: 'images' as const,
			href: '#group-images',
			label: t.groups.images,
			unset: data.setupItems.some((item) => item.id === 'imageStyle' && !item.done)
		},
		{
			id: 'loremaster' as const,
			href: '#group-loremaster',
			label: t.groups.loremaster,
			unset: data.setupItems.some((item) => item.id === 'loremasterVoice' && !item.done)
		},
		{ id: 'canon' as const, href: '#group-canon', label: t.groups.canon, unset: false }
	]);
</script>

<svelte:head><title>{t.headTitle(data.current.name)}</title></svelte:head>

<Page width="working" title={t.heading}>
	<SettingsShell>
		{#snippet rail()}
			<UniverseSettingsRail
				ariaLabel={t.rail.ariaLabel}
				incompleteMark={t.rail.incompleteMark}
				items={railItems}
			/>
		{/snippet}
		<p class="mt-4 max-w-measure text-body text-ink-2">
			{t.introBefore(data.current.name)}<InlineLink href={resolve('/settings/appearance')}
				>{t.appearanceLink}</InlineLink
			>{t.introAnd}<InlineLink href={resolve(`/settings/export/${data.current.slug}`)}
				>{t.exportLink}</InlineLink
			>{t.introAfter}
		</p>

		<section id="group-images" class="mt-8">
			<h2 class="text-title font-semibold text-ink">{t.groups.images}</h2>
			<div class="mt-3 border-t border-line pt-4">
				<h3 class="text-body font-semibold text-ink">{t.imageStyle.heading}</h3>
				<p class="mt-1 max-w-measure text-body text-ink-2">
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
					<form
						method="POST"
						action="?/selectImageStylePreset"
						class="contents"
						use:enhance={() => {
							applyingImageStylePreset = true;
							return async ({ update }) => {
								await update();
								applyingImageStylePreset = false;
							};
						}}
					>
						{#each data.imageStylePresets as preset (preset.id)}
							<!-- V9 (round seventeen, #501): a radio card is a control, so it earns the
							 micro-interaction group's "card that lifts under the pointer". `transition-all`
							 rather than a narrower `transition-transform`, the same shape `Button.svelte`'s
							 own press nudge already uses (#147): the border-colour swap on selection and the
							 lift both need to run, and only an unconditional transition class animates the
							 lift back out on pointer-leave too. Transform only, never a shadow - V3 spends
							 `--shadow-elevated` only on what genuinely floats over the page, and a settings
							 card on hover is not that. -->
							<label
								class="flex cursor-pointer flex-col overflow-hidden rounded-lg border border-line text-left transition-all hover:-translate-y-0.5 has-checked:border-accent has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
							>
								<input
									type="radio"
									name="presetId"
									value={preset.id}
									checked={currentImageStyleId === preset.id}
									disabled={applyingImageStylePreset}
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
									<span class="flex items-center gap-1 text-body font-medium text-ink">
										{preset.name}
										{#if currentImageStyleId === preset.id}
											<AcceptMark class="size-3.5 shrink-0 text-accent" />
											<span class="sr-only">{t.imageStyle.selectedLabel}</span>
										{/if}
									</span>
									<span class="text-label text-ink-2">{preset.description}</span>
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
							class="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2.5 text-body font-medium text-ink [&::-webkit-details-marker]:hidden"
						>
							<span
								class="text-label text-muted transition-transform"
								class:rotate-90={customOpen}
								aria-hidden="true">&#9656;</span
							>
							{t.imageStyle.customCard.label}
							{#if isCustomActive}
								<AcceptMark class="size-3.5 shrink-0 text-accent" />
								<span class="sr-only">{t.imageStyle.selectedLabel}</span>
							{/if}
						</summary>
						<div class="border-t border-line px-3 py-3">
							<p class="text-label text-ink-2">{t.imageStyle.customCard.hint}</p>
							<form
								method="POST"
								action="?/setImageStyle"
								class="mt-3 flex flex-col gap-3"
								use:enhance={() => {
									savingImageStyle = true;
									return async ({ update }) => {
										await update();
										savingImageStyle = false;
									};
								}}
							>
								<label class="flex flex-col gap-1 text-body text-ink-2">
									{t.imageStyle.nameLabel}
									<Input name="name" value={imageStyleName} required />
								</label>
								<label class="flex flex-col gap-1 text-body text-ink-2">
									{t.imageStyle.promptModifierLabel}
									<Textarea name="promptModifier" rows={2} value={imageStyleModifier} required />
								</label>
								<Button type="submit" variant="secondary" class="w-fit" disabled={savingImageStyle}>
									{savingImageStyle ? t.imageStyle.saving : t.imageStyle.save}
								</Button>
							</form>
						</div>
					</details>
				</div>
				{#if imageStyleError}
					<p class="mt-2 text-body text-danger">{imageStyleError}</p>
				{/if}
			</div>
		</section>

		<section id="group-loremaster" class="mt-8">
			<h2 class="text-title font-semibold text-ink">{t.groups.loremaster}</h2>
			<div class="mt-3 flex flex-col gap-4">
				<div class="border-t border-line pt-4">
					<h3 class="text-body font-semibold text-ink">{t.narration.heading}</h3>
					<p class="mt-1 max-w-measure text-body text-ink-2">
						{t.narration.description(data.current.name)}
					</p>

					<!-- Issue #451, decision U2: the picker's own card shape, copied from the image
			     style grid above with one substitution - an example sentence, italic, in
			     place of the example image, since a voice has nothing to show but something
			     to read aloud. Picking a preset posts `?/selectNarrationStylePreset`, which
			     only ever points universe.narration_style_id at the shipped row
			     (queries/narration.ts's selectUniverseNarrationStylePreset) - it never copies
			     the preset's clause anywhere, so an improved preset improves every world that
			     chose it. -->
					<fieldset class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
						<legend class="sr-only">{t.narration.pickerLegend}</legend>
						<form
							method="POST"
							action="?/selectNarrationStylePreset"
							class="contents"
							use:enhance={() => {
								applyingNarrationStylePreset = true;
								return async ({ update }) => {
									await update();
									applyingNarrationStylePreset = false;
								};
							}}
						>
							{#each data.narrationStylePresets as preset (preset.id)}
								<label
									class="flex cursor-pointer flex-col overflow-hidden rounded-lg border border-line p-3 text-left transition-all hover:-translate-y-0.5 has-checked:border-accent has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
								>
									<input
										type="radio"
										name="presetId"
										value={preset.id}
										checked={currentNarrationStyleId === preset.id}
										disabled={applyingNarrationStylePreset}
										class="sr-only"
										onchange={(event) => {
											event.currentTarget.form?.requestSubmit();
										}}
									/>
									<p class="text-label text-ink-2 italic">&ldquo;{preset.exampleSentence}&rdquo;</p>
									<span class="mt-2 flex items-center gap-1 text-body font-medium text-ink">
										{preset.name}
										{#if currentNarrationStyleId === preset.id}
											<AcceptMark class="size-3.5 shrink-0 text-accent" />
											<span class="sr-only">{t.narration.selectedLabel}</span>
										{/if}
									</span>
									<span class="mt-0.5 text-label text-ink-2">{preset.description}</span>
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
							class:border-accent={isCustomNarrationActive}
							class:border-line={!isCustomNarrationActive}
							bind:open={customNarrationOpen}
						>
							<summary
								class="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2.5 text-body font-medium text-ink [&::-webkit-details-marker]:hidden"
							>
								<span
									class="text-label text-muted transition-transform"
									class:rotate-90={customNarrationOpen}
									aria-hidden="true">&#9656;</span
								>
								{t.narration.customCard.label}
								{#if isCustomNarrationActive}
									<AcceptMark class="size-3.5 shrink-0 text-accent" />
									<span class="sr-only">{t.narration.selectedLabel}</span>
								{/if}
							</summary>
							<div class="border-t border-line px-3 py-3">
								<p class="text-label text-ink-2">{t.narration.customCard.hint}</p>
								<form
									method="POST"
									action="?/setNarrationStyle"
									class="mt-3 flex flex-col gap-3"
									use:enhance={() => {
										savingNarrationStyle = true;
										return async ({ update }) => {
											await update();
											savingNarrationStyle = false;
										};
									}}
								>
									<label class="flex flex-col gap-1 text-body text-ink-2">
										{t.narration.nameLabel}
										<Input name="name" value={narrationStyleName} required />
									</label>
									<label class="flex flex-col gap-1 text-body text-ink-2">
										{t.narration.promptClauseLabel}
										<Textarea
											name="promptClause"
											rows={2}
											value={narrationStylePromptClause}
											required
										></Textarea>
									</label>
									<Button
										type="submit"
										variant="secondary"
										class="w-fit"
										disabled={savingNarrationStyle}
									>
										{savingNarrationStyle ? t.narration.saving : t.narration.save}
									</Button>
								</form>
							</div>
						</details>
					</fieldset>
					{#if narrationStyleError}
						<p class="mt-2 text-body text-danger">{narrationStyleError}</p>
					{/if}
				</div>

				<!-- Issue #437, decision T10: the settings copy check the issue names - a
			     pointer from the corner of the product where a GM reasons about what the
			     Loremaster does to the conversation list where the stored record actually
			     lives (`shell.quickAsk.disclosure`, read in the panel itself before
			     anything is asked, is the primary disclosure). -->
				<div class="border-t border-line pt-4">
					<p class="max-w-measure text-body text-ink-2">{t.loremasterConversations.text}</p>
					<InlineLink
						href={resolve(`/w/${data.current.slug}/ask`)}
						class="mt-2 inline-block text-body">{t.loremasterConversations.link}</InlineLink
					>
				</div>

				<div class="border-t border-line pt-4">
					<div class="flex items-center justify-between gap-4">
						<div>
							<h3 class="text-body font-semibold text-ink">{t.aiToggle.heading}</h3>
							<p class="mt-1 max-w-measure text-body text-ink-2">
								{t.aiToggle.description(data.current.name)}
							</p>
						</div>
						<form
							method="POST"
							action="?/setAiEnabled"
							use:enhance={() => {
								settingAiEnabled = true;
								return async ({ update }) => {
									await update();
									settingAiEnabled = false;
								};
							}}
						>
							<input type="hidden" name="enabled" value={(!aiEnabled).toString()} />
							<Button
								type="submit"
								variant="secondary"
								class={aiEnabled
									? 'border-line-2 text-ink-2'
									: 'border-accent bg-accent-bg text-accent-ink'}
								disabled={settingAiEnabled}
							>
								{settingAiEnabled
									? aiEnabled
										? t.aiToggle.stoppingWriting
										: t.aiToggle.resumingWriting
									: aiEnabled
										? t.aiToggle.stopWriting
										: t.aiToggle.resumeWriting}
							</Button>
						</form>
					</div>
					{#if !aiEnabled}
						<!-- Round eleven P2 (#344), and guardrail 4 more than P2: the copilot's hue is
					     the last thing that should announce that the copilot is off. This notice is
					     the theme's own panel and line. -->
						<p
							class="mt-3 rounded-md border border-line bg-panel-2 px-3 py-2 text-label text-ink-2"
						>
							{t.aiToggle.offNotice(data.current.name)}
						</p>
					{/if}
				</div>

				<div class="border-t border-line pt-4">
					<h3 class="text-body font-semibold text-ink">{t.propagationCap.heading}</h3>
					<p class="mt-1 max-w-measure text-body text-ink-2">
						{t.propagationCap.description(data.current.name)}
					</p>
					<form
						method="POST"
						action="?/setPropagationCap"
						class="mt-3 flex flex-wrap items-center gap-3"
						use:enhance={() => {
							savingPropagationCap = true;
							return async ({ update }) => {
								await update();
								savingPropagationCap = false;
							};
						}}
					>
						<label class="flex items-center gap-2 text-body text-ink-2">
							{t.propagationCap.capLabel}
							<input
								type="number"
								name="cap"
								min="1"
								step="1"
								bind:value={capInput}
								disabled={noLimit}
								class="h-9 w-20 rounded-md border border-line-2 bg-panel px-2 text-body text-ink disabled:opacity-50"
							/>
						</label>
						<label class="flex items-center gap-2 text-body text-ink-2">
							<input
								type="checkbox"
								name="noLimit"
								value="true"
								bind:checked={noLimit}
								class="h-4 w-4"
							/>
							{t.propagationCap.noLimitLabel}
						</label>
						<Button type="submit" variant="secondary" class="w-fit" disabled={savingPropagationCap}>
							{savingPropagationCap ? t.propagationCap.saving : t.propagationCap.save}
						</Button>
						{#if form?.message}
							<p class="w-full text-body text-danger">{form.message}</p>
						{/if}
					</form>
					<p class="mt-3 text-label text-muted">
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
			<h2 class="text-title font-semibold text-ink">{t.groups.canon}</h2>
			<div class="mt-3 flex flex-col gap-4">
				<div class="border-t border-line pt-4">
					<div class="flex items-center justify-between gap-4">
						<div>
							<h3 class="text-body font-semibold text-ink">{tRelations.cardHeading}</h3>
							<p class="mt-1 max-w-measure text-body text-ink-2">
								{tRelations.cardDescription(data.current.name)}
							</p>
							<p class="mt-1 text-label text-muted">
								{tRelations.cardCountOwn(data.ownRelationTypeCount)}
							</p>
						</div>
						<Button
							href={resolve(`/w/${data.current.slug}/settings/relations`)}
							variant="secondary"
						>
							{tRelations.manageLink}
						</Button>
					</div>
				</div>

				{#if data.isDerived}
					<div class="border-t border-line pt-4">
						<h3 class="text-body font-semibold text-ink">{t.precedence.heading}</h3>
						<p class="mt-1 max-w-measure text-body text-ink-2">
							{t.precedence.description(data.current.name)}
						</p>

						{#if data.supersedes.length === 0}
							<p class="mt-3 text-body text-muted">{t.precedence.empty}</p>
						{:else}
							<ul class="mt-3 flex flex-col divide-y divide-line">
								{#each data.supersedes as row (row.id)}
									<li class="flex items-center gap-3 py-2 text-body">
										<span class="flex-1 text-ink-2 line-through decoration-line-2">
											{row.dataSourceName} &middot; {row.sourceUrl}
										</span>
										<Badge variant="secondary" class="text-muted uppercase">
											{t.precedence.supersededBadge}
										</Badge>
										<InlineLink href={resolve(`/w/${data.current.slug}/e/${row.entitySlug}`)}>
											{row.entityName}
										</InlineLink>
										<form
											method="POST"
											action="?/removeSupersede"
											use:enhance={() => {
												removingSupersede = true;
												return async ({ update }) => {
													await update();
													removingSupersede = false;
												};
											}}
										>
											<input type="hidden" name="id" value={row.id} />
											<Button
												type="submit"
												variant="link"
												size="sm"
												class="h-auto p-0 text-label text-muted hover:text-danger"
												disabled={removingSupersede}
											>
												{removingSupersede ? t.precedence.removing : t.precedence.remove}
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
							use:enhance={() => {
								addingSupersede = true;
								return async ({ update }) => {
									await update();
									addingSupersede = false;
								};
							}}
						>
							<h4 class="text-label font-semibold tracking-wide text-muted uppercase">
								{t.precedence.declareHeading}
							</h4>
							<div class="flex flex-col gap-1 text-body text-ink-2">
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
							<div class="flex flex-col gap-1 text-body text-ink-2">
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
							<label class="flex flex-col gap-1 text-body text-ink-2">
								{t.precedence.sourceUrlLabel}
								<Input name="sourceUrl" required />
							</label>
							<label class="flex flex-col gap-1 text-body text-ink-2">
								{t.precedence.noteLabel} <span class="text-muted">{t.precedence.optional}</span>
								<Input name="note" />
							</label>
							{#if form?.message}
								<p class="text-body text-danger">{form.message}</p>
							{/if}
							<Button type="submit" variant="secondary" class="w-fit" disabled={addingSupersede}>
								{addingSupersede ? t.precedence.superseding : t.precedence.submit}
							</Button>
						</form>
					</div>
				{/if}
			</div>
		</section>
	</SettingsShell>
</Page>
