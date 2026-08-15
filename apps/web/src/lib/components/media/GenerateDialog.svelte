<script lang="ts">
	/**
	 * F1 = C: "Generate image" always opens a choice - one image or four, cost shown for
	 * each, before anything runs. Decision's own recommendation: default the radio from
	 * entity type (variants for a character, portrait otherwise), but the choice always
	 * stays a real, visible one - never silently decided by type alone (that was option B,
	 * rejected).
	 */
	import { messages, type Locale } from '$lib/i18n';
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
		locale
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
		onGenerate: (feature: ImageFeature) => void;
		onEditStyle: () => void;
		locale: Locale;
	} = $props();
	let t = $derived(messages(locale));

	let feature = $state<'portrait' | 'variants'>('portrait');

	let dialogEl: HTMLDialogElement | undefined;

	$effect(() => {
		if (!dialogEl) return;
		if (open && !dialogEl.open) {
			dialogEl.showModal();
			// Reset the suggested default every time the dialog opens, reading entityType
			// here rather than at declaration time: the dialog is not remounted per entity
			// (EntryMediaPanel persists across a navigation to a different entry), so a
			// bare `$state(entityType === ...)` would keep suggesting the previous entry's
			// default. A user's own radio pick is never touched while the dialog stays
			// open, since this branch only runs on the open transition.
			feature = entityType === 'character' ? 'variants' : 'portrait';
		}
		if (!open && dialogEl.open) dialogEl.close();
	});

	function close(): void {
		open = false;
	}
</script>

<dialog
	bind:this={dialogEl}
	onclose={close}
	onclick={(e) => {
		if (e.target === dialogEl) close();
	}}
	class="max-w-md rounded-lg border border-line bg-panel p-0 text-ink backdrop:bg-ink/40"
>
	<div class="p-5">
		<h3 class="text-base font-semibold text-ink">{t.entry.media.dialogTitle(entityName)}</h3>

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

		<div class="mt-4 flex gap-2">
			<button
				type="button"
				class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-panel hover:bg-accent-ink disabled:opacity-50"
				disabled={busy || (feature === 'portrait' ? !portraitModel : !variantsModel)}
				onclick={() => onGenerate(feature)}
			>
				{busy ? t.entry.media.generating : t.entry.media.generateAction}
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
</dialog>
