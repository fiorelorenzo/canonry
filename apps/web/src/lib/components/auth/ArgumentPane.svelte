<script lang="ts">
	/**
	 * Sign-up's right pane (I2 = B, #139): the product's one trick drawn static on
	 * the sample world (docs/ux/SAMPLE-WORLD.md's "edit that triggers propagation").
	 * Entirely static - no model call, no network, nothing here is fetched or
	 * computed from a real universe. Entity names (Aldric Vane, the Watch, the
	 * Ledger) are canon proper nouns and stay untranslated, same rule this app
	 * already applies to its own brand name (see sign-in's old doc comment); the
	 * prose around them is the translated unit (guardrail 7, #139).
	 *
	 * Guardrail 1: this pane may not show an accept control, because it is
	 * marketing copy standing in a product whose whole promise is that nothing a
	 * model writes lands without one. The badge says "waiting for you" and the
	 * closing line says nothing was applied - it does not say press this to
	 * apply it. No button, no link, no keyboard target anywhere in this file.
	 */
	import Badge from '$lib/components/ui/badge/badge.svelte';
	import { messages, type Locale } from '$lib/i18n';

	let { locale }: { locale: Locale } = $props();

	const t = $derived(messages(locale).auth.argument);
	const characterLabel = $derived(messages(locale).proposals.diffCard.entityTypeLabel('character'));
</script>

<div class="flex max-w-sm flex-col gap-4">
	<p class="text-sm text-ink-2">{t.intro}</p>

	<div class="rounded-md border border-line bg-panel p-4">
		<div class="flex items-center justify-between gap-2">
			<h3 class="font-serif text-sm font-semibold text-ink">Aldric Vane</h3>
			<Badge variant="secondary">{characterLabel}</Badge>
		</div>
		<p class="mt-2 text-sm text-ink-2">{t.aldricSentence}</p>
	</div>

	<div class="rounded-md border border-ai-line bg-panel p-4">
		<div class="flex items-center justify-between gap-2">
			<h3 class="font-serif text-sm font-semibold text-ink">The Valdoria Watch</h3>
			<Badge class="border-ai-line bg-ai-bg text-ai">{t.waitingBadge}</Badge>
		</div>
		<p class="mt-2 text-sm text-ink-2">
			{t.watchLeadPrefix}
			<span class="text-muted line-through decoration-line-2">{t.watchBefore}</span>
			<span class="rounded-sm bg-ai-bg px-1 py-0.5 text-ink">{t.watchAfter}</span>.
		</p>
		<p class="mt-2 font-mono text-[11px] text-ai">{t.evidence}</p>
	</div>

	<p class="text-xs text-muted">{t.disclaimer}</p>
</div>
