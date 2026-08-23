<script lang="ts">
	/**
	 * Issue #345: what a running model looks like. Every generator in this product calls a
	 * model inside the request that started it, and the only feedback any of them gave was a
	 * disabled button whose label changed, which is indistinguishable from a hung page for
	 * the twenty to forty seconds a premium draft actually takes.
	 *
	 * Three parts, and the third is the one that does the work: a spinner, the caller's own
	 * sentence naming what is being drafted, and a counter of seconds elapsed. The counter is
	 * the honest part - it says the page is alive without promising a finish time, which is
	 * the same reason decision E2 refused a progress bar for the table's lanes. Past
	 * `slowAfterMs` a second sentence says a long draft can take a while, so a wait that runs
	 * long reads as a long wait rather than as a failure.
	 *
	 * `role="status"` with `aria-live="polite"`: a screen reader hears the sentence when it
	 * appears, and the seconds counter is deliberately outside the live region (marked
	 * `aria-hidden`), because announcing a new number every second is noise, not progress.
	 */
	import { messages, type Locale } from '$lib/i18n';

	let {
		label,
		locale,
		slowAfterMs = 20_000
	}: {
		/** Already localized by the caller: what this particular model is doing. */
		label: string;
		locale: Locale;
		slowAfterMs?: number;
	} = $props();

	let t = $derived(messages(locale).controls.modelRunning);

	let elapsedMs = $state(0);

	$effect(() => {
		const startedAt = Date.now();
		const timer = setInterval(() => (elapsedMs = Date.now() - startedAt), 1000);
		return () => clearInterval(timer);
	});
</script>

<div class="model-running flex flex-wrap items-center gap-2 text-label text-ink-2">
	<span class="ring" aria-hidden="true"></span>
	<span role="status" aria-live="polite">{label}</span>
	<span class="font-mono text-muted" aria-hidden="true">
		{t.elapsed(Math.floor(elapsedMs / 1000))}
	</span>
	{#if elapsedMs >= slowAfterMs}
		<span class="text-muted">{t.slow}</span>
	{/if}
</div>

<style>
	.ring {
		width: 0.85rem;
		height: 0.85rem;
		flex: none;
		border-radius: 9999px;
		border: 2px solid var(--color-line-2);
		border-top-color: var(--color-accent);
		animation: model-running-spin 0.9s linear infinite;
	}

	/* A spinner is motion for its own sake to anyone who asked the system for less of it;
	   the seconds counter beside it already carries the same information. */
	@media (prefers-reduced-motion: reduce) {
		.ring {
			animation: none;
			border-top-color: var(--color-line-2);
		}
	}

	@keyframes model-running-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
