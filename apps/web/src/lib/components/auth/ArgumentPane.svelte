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
	 *
	 * #729: the two entity names here are not headings, and that is deliberate. This pane
	 * is a picture of the product's own UI drawn in marketing copy, so "Aldric Vane" and
	 * "The Valdoria Watch" are labels inside a simulated proposal card rather than sections
	 * of the sign-up document, the same way text inside a screenshot is not a heading. They
	 * used to be `<h3>` under AuthShell's `sr-only <h1>`, which skipped h2 and made the
	 * page's outline depend on its width: the pane is `hidden min-[900px]:block`, so the
	 * two headings were in the DOM at every width and only exposed above 900px, where axe
	 * reported `heading-order`. The real card this mock imitates, `ProposalDiffCard`, takes
	 * its heading level from the caller (#672) and renders the entity name as a plain link
	 * whenever it has a slug, so "no heading" is what this context asks for rather than a
	 * level to pick. The outline is now one `<h1>` at every width.
	 */
	import Badge from '$lib/components/ui/badge/badge.svelte';
	import { messages, type Locale } from '$lib/i18n';

	let { locale }: { locale: Locale } = $props();

	const t = $derived(messages(locale).auth.argument);
	const characterLabel = $derived(messages(locale).proposals.diffCard.entityTypeLabel('character'));
</script>

<div class="flex max-w-sm flex-col gap-4">
	<p class="text-body text-ink-2">{t.intro}</p>

	<div class="rounded-md border border-line bg-panel p-4">
		<div class="flex items-center justify-between gap-2">
			<p class="font-serif text-title font-semibold text-ink">Aldric Vane</p>
			<Badge variant="secondary">{characterLabel}</Badge>
		</div>
		<p class="mt-2 text-body text-ink-2">{t.aldricSentence}</p>
	</div>

	<div class="rounded-md border border-line bg-panel p-4">
		<div class="flex items-center justify-between gap-2">
			<p class="font-serif text-title font-semibold text-ink">The Valdoria Watch</p>
			<Badge variant="secondary">{t.waitingBadge}</Badge>
		</div>
		<p class="mt-2 border-l-2 border-diff-line bg-diff-bg py-0.5 pr-2 pl-3 text-body text-ink-2">
			{t.watchLeadPrefix}
			<span class="text-ink-2 line-through decoration-diff-line decoration-2">{t.watchBefore}</span>
			<span class="font-semibold text-ink">{t.watchAfter}</span>.
		</p>
		<p class="mt-2 font-mono text-label text-muted">{t.evidence}</p>
	</div>

	<p class="text-label text-muted">{t.disclaimer}</p>
</div>
