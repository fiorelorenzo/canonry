<script lang="ts">
	/**
	 * Issue #80: a quick note taken at the table becomes a proposal, never a direct write,
	 * and is marked as one - that is guardrail 1 at the table. This form only picks a target
	 * and types text; `/table/notes` (server) is what turns it into a pending `update`
	 * proposal, and the confirmation here says "saved as a proposal", never "saved".
	 */
	import { messages, type Locale } from '$lib/i18n';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Button } from '$lib/components/ui/button';
	import type { EntityRef } from './types';

	let {
		targets,
		locale,
		onSubmit,
		onCancel
	}: {
		targets: EntityRef[];
		locale: Locale;
		onSubmit: (input: { targetEntityId: string; note: string }) => void;
		onCancel: () => void;
	} = $props();

	const t = $derived(messages(locale).table.quickNoteForm);

	let targetEntityId = $state(targets[0]?.id ?? '');
	let note = $state('');

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = note.trim();
		if (!trimmed || !targetEntityId) return;
		onSubmit({ targetEntityId, note: trimmed });
		note = '';
	}
</script>

<form
	onsubmit={submit}
	class="flex flex-col gap-2.5 rounded-lg border border-line-2 bg-panel-2 p-3"
	aria-label={t.formLabel}
>
	<p class="text-xs text-muted">
		{t.disclaimer}
	</p>
	<div class="flex flex-col gap-1">
		<label for="table-note-target" class="font-mono text-[10px] tracking-wide text-muted uppercase">
			{t.about}
		</label>
		<select
			id="table-note-target"
			bind:value={targetEntityId}
			class="rounded-md border border-line-2 bg-panel px-2.5 py-1.5 text-sm text-ink"
		>
			{#each targets as target (target.id)}
				<option value={target.id}>{target.name}</option>
			{/each}
		</select>
	</div>
	<div class="flex flex-col gap-1">
		<label for="table-note-text" class="font-mono text-[10px] tracking-wide text-muted uppercase">
			{t.note}
		</label>
		<Textarea id="table-note-text" bind:value={note} rows={3} placeholder={t.notePlaceholder} />
	</div>
	<div class="flex justify-end gap-2">
		<Button type="button" variant="secondary" onclick={onCancel}>
			{t.cancel}
		</Button>
		<Button type="submit" disabled={!targetEntityId}>
			{t.saveAsProposal}
		</Button>
	</div>
</form>
