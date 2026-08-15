<script lang="ts">
	/**
	 * SPEC.md §5, issue #54: a control that runs `completeEntry` and lands its output as a
	 * normal pending `update` proposal - guardrail 1, so it flows through the exact same
	 * accept path everything else does rather than getting a private one. Nothing here
	 * ever shows the drafted text: the moment the action succeeds, the page's own reload
	 * (`update()`) re-runs `load`, and `EntryProseWithSecrets`'s existing C1 = B marking
	 * (wired by #106) picks up the new pending proposal exactly like it would any other -
	 * this control has no second "here is what I drafted" treatment of its own.
	 *
	 * Guardrail 4: disabled, with a reason, whenever this universe's AI is off - the same
	 * belt-and-suspenders treatment `EntryMediaPanel`'s Generate button already uses (a
	 * disabled attribute plus a visible sentence, not just a `title` tooltip nobody reads).
	 */
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import { messages, type Locale } from '$lib/i18n';

	let { aiEnabled, locale }: { aiEnabled: boolean; locale: Locale } = $props();
	let t = $derived(messages(locale));

	let completing = $state(false);
	let message = $state<string | null>(null);
</script>

<div class="flex-none text-right">
	<form
		method="POST"
		action="?/complete"
		use:enhance={() => {
			completing = true;
			message = null;
			return async ({ result, update }) => {
				completing = false;
				if (result.type === 'success' && result.data) {
					message = result.data.completeEmpty ? t.entry.complete.empty : t.entry.complete.drafted;
				} else if (result.type === 'failure' && result.data) {
					message = String(result.data.completeError ?? t.entry.complete.genericFailure);
				}
				// Refreshes `load()` so a real new proposal (not the empty case above, which
				// already rejected itself) shows up through the same pending-proposal banner
				// and marking every other proposal uses - never a second, private treatment.
				await update();
			};
		}}
	>
		<Button type="submit" variant="secondary" size="sm" disabled={!aiEnabled || completing}>
			{completing ? t.entry.complete.completing : t.entry.complete.button}
		</Button>
	</form>
	{#if !aiEnabled}
		<p class="mt-1 text-xs text-muted">{t.entry.complete.aiOff}</p>
	{:else if message}
		<p class="mt-1 text-xs text-muted">{message}</p>
	{/if}
</div>
