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
	 *
	 * Round sixteen U10 (#454): the Watch card lost the copilot's hue, which was
	 * chrome around this mock rather than C1's own mark. The before/after sentence is a
	 * diff, so it now reads as one on P3's hue-less `--color-diff-line`/`--color-diff-bg`,
	 * the exact treatment `ProposalDiffCard.svelte` uses for a real proposal.
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
			<h3 class="font-serif text-title font-semibold text-ink">Aldric Vane</h3>
			<Badge variant="secondary">{characterLabel}</Badge>
		</div>
		<p class="mt-2 text-sm text-ink-2">{t.aldricSentence}</p>
	</div>

	<div class="rounded-md border border-line bg-panel p-4">
		<div class="flex items-center justify-between gap-2">
			<h3 class="font-serif text-title font-semibold text-ink">The Valdoria Watch</h3>
			<Badge variant="secondary">{t.waitingBadge}</Badge>
		</div>
		<p class="mt-2 border-l-2 border-diff-line bg-diff-bg py-0.5 pr-2 pl-3 text-sm text-ink-2">
			{t.watchLeadPrefix}
			<span class="text-ink-2 line-through decoration-diff-line decoration-2">{t.watchBefore}</span>
			<span class="font-semibold text-ink">{t.watchAfter}</span>.
		</p>
		<p class="mt-2 font-mono text-label text-muted">{t.evidence}</p>
	</div>

	<p class="text-xs text-muted">{t.disclaimer}</p>
</div>
