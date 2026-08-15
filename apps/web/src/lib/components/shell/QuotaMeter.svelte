<script lang="ts">
	/**
	 * Issue #150 (F2 = A: "a meter in the shell", H1's spend rule). Two lines, not
	 * one - included quota and the warm budget are counted separately (SPEC.md §15)
	 * and merging them into one bar hides the thing a GM needs mid-session. Both
	 * numbers are `quota`, read straight from `routes/+layout.server.ts`'s own read
	 * of `billingSummaryFor` - the same balance /settings/billing renders. Nothing
	 * here recomputes a balance or reaches for the database.
	 *
	 * H1: reading is free. Semantic search, mention suggestions and the retrieval
	 * behind an Ask never draw on either number (`operation_price` prices them at
	 * zero) - on every universe, switch on or off. This meter simply renders
	 * whatever `quota` says, so a universe whose writing switch is off shows a
	 * meter that holds still, which is the point of H1's answer rather than a bug
	 * to chase here.
	 *
	 * Guardrail 7 / SPEC.md §15: both totals are a real, finite ceiling - the
	 * catalogue this reads from (`shell.quota`) has no "unlimited" string to reach
	 * for, and neither bar can visually read past 100%.
	 *
	 * Colour: `--color-accent` for the included line, `--color-warn` for the warm
	 * line. Never `--color-ai` - that hue is the copilot's alone (C1), and this is
	 * not a copilot surface.
	 */
	import { messages, type Locale } from '$lib/i18n';
	import type { ShellQuota } from './types';

	let { quota, locale }: { quota: ShellQuota; locale: Locale } = $props();

	const t = $derived(messages(locale).shell.quota);

	function fraction(remaining: number, total: number): number {
		if (total <= 0) return 0;
		return Math.min(1, Math.max(0, remaining / total));
	}
</script>

<div class="flex flex-col gap-2">
	<div class="flex flex-col gap-1">
		<div class="flex items-baseline justify-between gap-2 text-xs text-muted">
			<span>{t.includedHeading}</span>
			<span class="tabular-nums">{t.ratio(quota.includedRemaining, quota.includedTotal)}</span>
		</div>
		<div
			class="h-1.5 overflow-hidden rounded-full bg-line"
			role="progressbar"
			aria-label={t.includedHeading}
			aria-valuemin={0}
			aria-valuemax={quota.includedTotal}
			aria-valuenow={Math.max(0, Math.min(quota.includedRemaining, quota.includedTotal))}
		>
			<div
				class="h-full rounded-full bg-accent"
				style={`width: ${fraction(quota.includedRemaining, quota.includedTotal) * 100}%`}
			></div>
		</div>
	</div>

	<div class="flex flex-col gap-1">
		<div class="flex items-baseline justify-between gap-2 text-xs text-muted">
			<span>{t.warmHeading}</span>
			<span class="tabular-nums">{t.ratio(quota.warmRemaining, quota.warmTotal)}</span>
		</div>
		<div
			class="h-1.5 overflow-hidden rounded-full bg-line"
			role="progressbar"
			aria-label={t.warmHeading}
			aria-valuemin={0}
			aria-valuemax={quota.warmTotal}
			aria-valuenow={Math.max(0, Math.min(quota.warmRemaining, quota.warmTotal))}
		>
			<div
				class="h-full rounded-full bg-warn"
				style={`width: ${fraction(quota.warmRemaining, quota.warmTotal) * 100}%`}
			></div>
		</div>
	</div>
</div>
