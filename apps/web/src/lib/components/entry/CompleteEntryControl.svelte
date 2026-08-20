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
	 * Guardrail 4: disabled, with a reason, whenever this universe's AI is off - the same
	 * belt-and-suspenders treatment `EntryMediaPanel`'s Generate button already uses (a
	 * disabled attribute plus a visible sentence, not just a `title` tooltip nobody reads).
	 */
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import { messages, type Locale } from '$lib/i18n';

	let {
		aiEnabled,
		locale,
		running = $bindable(false),
		onDrafted
	}: {
		aiEnabled: boolean;
		locale: Locale;
		/** True while the model is drafting. Bound out rather than kept private, because the
		 * page renders the waiting state down in the reading flow, not up here. */
		running?: boolean;
		/** A real proposal exists now (never fired for the empty case, which rejected
		 * itself). */
		onDrafted?: () => void;
	} = $props();
	let t = $derived(messages(locale).entry.complete);

	let message = $state<string | null>(null);
</script>

<div class="flex-none text-right">
	<form
		method="POST"
		action="?/complete"
		use:enhance={() => {
			running = true;
			message = null;
			return async ({ result, update }) => {
				running = false;
				let drafted = false;
				if (result.type === 'success' && result.data) {
					drafted = !result.data.completeEmpty;
					message = result.data.completeEmpty ? t.empty : null;
				} else if (result.type === 'failure' && result.data) {
					message = String(result.data.completeError ?? t.genericFailure);
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
		<Button type="submit" variant="secondary" size="sm" disabled={!aiEnabled || running}>
			{t.button}
		</Button>
	</form>
	{#if !aiEnabled}
		<p class="mt-1 text-xs text-muted">{t.aiOff}</p>
	{:else if message}
		<p class="mt-1 text-xs text-muted">{message}</p>
	{/if}
</div>
