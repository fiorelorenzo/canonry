<script lang="ts">
	/**
	 * F1 = C: "Generate image" always opens a choice - one image or four, cost shown for
	 * each, before anything runs. Decision's own recommendation: default the radio from
	 * entity type (variants for a character, portrait otherwise), but the choice always
	 * stays a real, visible one - never silently decided by type alone (that was option B,
	 * rejected).
	 *
	 * #255: the same dialog also drives a regeneration, when `regenerateSource` is set -
	 * G11 ("confirm every paid action") applies to a regeneration exactly as much as a
	 * first generation, so it gets the same one-action confirm rather than a second,
	 * lighter-weight surface. In that mode the choice this dialog exists for is already
	 * made (always one new candidate, from the picture named by `regenerateSource`), so
	 * the radio group and the style row - which has no effect on a regeneration; the
	 * prompt carries the source asset's own already-resolved style forward - both give
	 * way to a thumbnail of what is being refined and the instruction field itself.
	 */
	import { messages, type Locale } from '$lib/i18n';
	import { Dialog, DialogContent, DialogTitle } from '$lib/components/ui/dialog';
	import { Textarea } from '$lib/components/ui/textarea';
	import type { ImageFeature } from '@canonry/db/schema';

	type ModelSummary = { provider: string; modelId: string } | null;

	let {
		open = $bindable(false),
		entityName,
		entityType,
		styleModifier,
		portraitPrice,
		variantsPrice,
		portraitModel,
		variantsModel,
		busy,
		onGenerate,
		onEditStyle,
		locale,
		regenerateSource = null
	}: {
		open?: boolean;
		entityName: string;
		entityType: string;
		styleModifier: string | null;
		portraitPrice: number;
		variantsPrice: number;
		portraitModel: ModelSummary;
		variantsModel: ModelSummary;
		busy: boolean;
		onGenerate: (feature: ImageFeature, instruction?: string) => void;
		onEditStyle: () => void;
		locale: Locale;
		/** #255: the candidate being refined, or null for a fresh generation. */
		regenerateSource?: { id: string; imageUrl: string } | null;
	} = $props();
	let t = $derived(messages(locale));

	let feature = $state<'portrait' | 'variants'>('portrait');
	let instruction = $state('');

	// Round thirteen R2 (#377): the vendored Dialog owns showModal/close, escape,
	// scrim-click and focus-return, so the old effect's `dialogEl.open` check goes
	// away. What has to survive is the per-open reset below, tracked against the
	// closed-to-open transition the same way that check did: EntryMediaPanel
	// persists across a navigation to a different entry, so a bare
	// `$state(entityType === ...)` would keep suggesting the previous entry's
	// default.
	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) {
			// A user's own radio pick is never touched while the dialog stays open,
			// since this only runs on the open transition. A regeneration is always
			// exactly one new candidate (#255) - there is no batch-of-four reading of
			// "refine this one picture" - so it forces portrait rather than reading
			// entityType at all.
			feature = regenerateSource
				? 'portrait'
				: entityType === 'character'
					? 'variants'
					: 'portrait';
			instruction = '';
		}
		wasOpen = open;
	});

	function close(): void {
		open = false;
	}
</script>

<Dialog bind:open>
	<!-- Round thirteen R2 (#377): every native <dialog> in the app opened flush to
	     the window's top-left corner instead of centred. The user-agent stylesheet
	     centres a modal dialog with `margin: auto`, and Tailwind 4's preflight sets
	     `margin: 0` on `*`, `::before`, `::after` and `::backdrop` - measured on the
	     entry page, a bare <dialog> with these same classes reported `margin: 0px`
	     and a rect at `x: 0, y: 0`. The vendored Dialog below positions itself with
	     `fixed` + a transform, which preflight's margin reset cannot touch. -->
	<DialogContent
		closeLabel={t.entry.media.cancel}
		class="max-w-md rounded-lg border border-line bg-panel p-0 text-ink"
	>
		<div class="p-5">
			<DialogTitle class="text-title font-semibold text-ink">
				{regenerateSource
					? t.entry.media.regenerate.dialogTitle(entityName)
					: t.entry.media.dialogTitle(entityName)}
			</DialogTitle>

			{#if regenerateSource}
				<p class="mt-2 text-xs text-muted">{t.entry.media.regenerate.hint}</p>
				<div class="mt-3 flex gap-3">
					<img
						src={regenerateSource.imageUrl}
						alt=""
						class="h-20 w-20 shrink-0 rounded-md border border-line object-cover"
					/>
					<div class="flex-1">
						<label class="block text-xs font-medium text-ink-2" for="regenerate-instruction">
							{t.entry.media.regenerate.instructionLabel}
						</label>
						<Textarea
							id="regenerate-instruction"
							bind:value={instruction}
							rows={3}
							class="mt-1"
							placeholder={t.entry.media.regenerate.instructionPlaceholder}
						/>
					</div>
				</div>
				<p class="mt-3 text-xs text-muted">
					{portraitModel ? t.entry.media.creditsLabel(portraitPrice) : t.entry.media.notConfigured}
				</p>
			{:else}
				<div
					class="mt-3 flex items-center gap-2 rounded-full border border-dashed border-line-2 bg-panel-2 px-3 py-1.5 text-xs text-ink-2"
				>
					<span class="flex-1">
						{t.entry.media.styleLabel(styleModifier)}
					</span>
					<button
						type="button"
						class="font-medium text-accent-ink hover:underline"
						onclick={() => {
							close();
							onEditStyle();
						}}
					>
						{t.entry.media.editStyle}
					</button>
				</div>

				<div
					class="mt-4 flex flex-col gap-2"
					role="radiogroup"
					aria-label={t.entry.media.howManyAriaLabel}
				>
					<label
						class="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2"
						class:border-accent={feature === 'variants'}
						class:border-line={feature !== 'variants'}
					>
						<input type="radio" name="feature" value="variants" bind:group={feature} class="mt-1" />
						<span class="flex-1">
							<span class="block text-sm text-ink">{t.entry.media.fourOptions}</span>
							<span class="block text-xs text-muted">
								{variantsModel ? variantsModel.modelId : t.entry.media.notConfigured}
								{entityType === 'character' ? ` ${t.entry.media.suggestedForCharacter}` : ''}
							</span>
						</span>
						<span
							class="rounded-full bg-panel-2 px-2 py-0.5 text-xs font-medium text-ink-2 tabular-nums"
						>
							{t.entry.media.creditsLabel(variantsPrice)}
						</span>
					</label>

					<label
						class="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2"
						class:border-accent={feature === 'portrait'}
						class:border-line={feature !== 'portrait'}
					>
						<input type="radio" name="feature" value="portrait" bind:group={feature} class="mt-1" />
						<span class="flex-1">
							<span class="block text-sm text-ink">{t.entry.media.oneImage}</span>
							<span class="block text-xs text-muted"
								>{portraitModel ? portraitModel.modelId : t.entry.media.notConfigured}</span
							>
						</span>
						<span
							class="rounded-full bg-panel-2 px-2 py-0.5 text-xs font-medium text-ink-2 tabular-nums"
						>
							{t.entry.media.creditsLabel(portraitPrice)}
						</span>
					</label>
				</div>

				<p class="mt-3 text-xs text-muted">
					{t.entry.media.privateHint}
				</p>
			{/if}

			<div class="mt-4 flex gap-2">
				<button
					type="button"
					class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-panel hover:bg-accent-ink disabled:opacity-50"
					disabled={busy ||
						(regenerateSource
							? !portraitModel || instruction.trim().length === 0
							: feature === 'portrait'
								? !portraitModel
								: !variantsModel)}
					onclick={() => onGenerate(feature, regenerateSource ? instruction.trim() : undefined)}
				>
					{#if regenerateSource}
						{busy ? t.entry.media.regenerate.regenerating : t.entry.media.regenerate.action}
					{:else}
						{busy ? t.entry.media.generating : t.entry.media.generateAction}
					{/if}
				</button>
				<button
					type="button"
					class="rounded-md border border-line-2 px-3 py-1.5 text-sm text-ink-2 hover:bg-panel-2"
					onclick={close}
				>
					{t.entry.media.cancel}
				</button>
			</div>
		</div>
	</DialogContent>
</Dialog>
