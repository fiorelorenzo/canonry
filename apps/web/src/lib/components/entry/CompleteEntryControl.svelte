<script lang="ts">
	/**
	 * SPEC.md §5, issue #54: a control that runs `completeEntry` and lands its output as a
	 * normal pending `update` proposal - guardrail 1, so it flows through the exact same
	 * accept path everything else does rather than getting a private one. Nothing here
	 * ever shows the drafted text: the moment the action succeeds, the page's own reload
	 * (`update()`) re-runs `load`, and both `EntryProseWithSecrets`'s C1 = B marking (#106)
	 * and the page's review region (#345) pick up the new pending proposal exactly like
	 * they would any other - this control has no second "here is what I drafted" treatment
	 * of its own.
	 *
	 * Issue #345 changed two things about the wait, and nothing about the write. The button
	 * no longer relabels itself, because a disabled button whose text changed is the weakest
	 * possible claim that a model is running: `running` is bound out to the page, which shows
	 * `ModelRunning` in the spot the proposal will occupy. And `onDrafted` fires once a draft
	 * really landed, so the page can move focus into the region: keyboard-only, completing an
	 * entry and accepting the result is Enter then `a`.
	 *
	 * Round fifteen T1 (#428): the button itself became a `FormattingToolbar`-shaped icon on
	 * the title's own line (Q4: one `Tooltip.Provider` up in `+page.svelte`, shared with the
	 * `Modifica` icon beside this one, a `Tooltip.Root` here), so both the wait and the
	 * outcome move out with it. The empty/failure sentence now fires through `onMessage`
	 * rather than a second bindable next to `running` - "the result lands where the wait
	 * was", extended from success to the empty/failure case, and the page shows it in the
	 * review region, beside where `ModelRunning` sits while this runs.
	 *
	 * Guardrail 4's AI-off reason moves too, but not there: it is true before any click, not
	 * the outcome of one, so the page keeps it a plain, always-visible sentence next to the
	 * entry's own type/aliases line rather than filing it beside a "just ran" message it has
	 * nothing to do with. This tooltip still repeats it on hover/focus for whoever is already
	 * looking at the glyph, but per this file's own old belt-and-suspenders note, a tooltip
	 * alone was never going to be the whole answer.
	 *
	 * G11 ("confirm every paid action"): a bare glyph cannot gesture at "this spends
	 * credits" the way the old text button's own label at least did, so the tooltip carries
	 * `t.hint(price)` rather than just repeating `t.button` - stated before the click that
	 * spends it, the same shape `cover.generateHint` already gives its own button.
	 */
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import { messages, type Locale } from '$lib/i18n';

	let {
		aiEnabled,
		price,
		locale,
		running = $bindable(false),
		onMessage,
		onDrafted
	}: {
		aiEnabled: boolean;
		/** Credits `entry.complete` costs (`@canonry/db`'s seeded `operation_price` row,
		 * the same one the `complete` action already charges via `chargeFor`), for the
		 * tooltip's own G11 confirmation. */
		price: number;
		locale: Locale;
		/** True while the model is drafting. Bound out rather than kept private, because the
		 * page renders the waiting state down in the reading flow, not up here. */
		running?: boolean;
		/** The empty-completion or failure sentence (`null` to clear it), fired rather than
		 * kept in a bindable: nothing here ever reads it back, so it is a one-way report to
		 * the page - the same shape `onDrafted` already uses, and one that does not trip a
		 * write-only-variable lint the way a `$bindable` with no local read here would. */
		onMessage?: (message: string | null) => void;
		/** A real proposal exists now (never fired for the empty case, which rejected
		 * itself). */
		onDrafted?: () => void;
	} = $props();
	let t = $derived(messages(locale).entry.complete);
</script>

<form
	method="POST"
	action="?/complete"
	use:enhance={() => {
		running = true;
		return async ({ result, update }) => {
			running = false;
			let drafted = false;
			if (result.type === 'success' && result.data) {
				drafted = !result.data.completeEmpty;
				onMessage?.(result.data.completeEmpty ? t.empty : null);
			} else if (result.type === 'failure' && result.data) {
				onMessage?.(String(result.data.completeError ?? t.genericFailure));
			} else {
				onMessage?.(null);
			}
			// Refreshes `load()` so a real new proposal (not the empty case above, which
			// already rejected itself) shows up through the same review region and marking
			// every other proposal uses - never a second, private treatment.
			await update();
			// After `update()`, so the region the focus lands in is the one holding the
			// proposal this run just produced.
			if (drafted) onDrafted?.();
		};
	}}
>
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					type="submit"
					variant="ghost"
					size="icon"
					disabled={!aiEnabled || running}
					aria-label={t.button}
				>
					<SparklesIcon aria-hidden="true" />
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content>{aiEnabled ? t.hint(price) : t.aiOff}</Tooltip.Content>
	</Tooltip.Root>
</form>
