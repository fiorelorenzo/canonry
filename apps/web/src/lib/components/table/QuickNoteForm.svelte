<script lang="ts">
	/**
	 * Issue #80: a quick note taken at the table becomes a proposal, never a direct write,
	 * and is marked as one - that is guardrail 1 at the table. This form only picks a target
	 * and types text; `/table/notes` (server) is what turns it into a pending `update`
	 * proposal, and the confirmation here says "saved as a proposal", never "saved".
	 *
	 * Issue #286, decision O4 = B: the target is the GM's own data, whatever is pinned to
	 * this session plus the declared place, so it is the combobox with search. This is the
	 * call site the decision picked out as the one worth the third control, because the
	 * list is uncapped and this is the one place in the product where the reader is at a
	 * table with players waiting.
	 *
	 * **Without JavaScript this form does nothing, on purpose, and that has not changed.**
	 * It has no `action` and never had one: `onsubmit` cancels the event and hands the
	 * note to the table page, which posts it over `fetch` and streams the result back.
	 * The whole surface is behind a client-side toggle, so there is no `<noscript>`
	 * fallback here and nothing for one to post to.
	 */
	import { messages, type Locale } from '$lib/i18n';
	import { Combobox } from '$lib/components/ui/combobox';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Button } from '$lib/components/ui/button';
	import type { EntityRef } from './types';

	let {
		targets,
		locale,
		pending = false,
		onSubmit,
		onCancel
	}: {
		targets: EntityRef[];
		locale: Locale;
		/** #497 (V11): true while the parent's own `fetch` to `/table/notes` is in
		 * flight. */
		pending?: boolean;
		onSubmit: (input: { targetEntityId: string; note: string }) => void;
		onCancel: () => void;
	} = $props();

	const t = $derived(messages(locale).table.quickNoteForm);
	const tControls = $derived(messages(locale).controls);

	const targetOptions = $derived(
		targets.map((target) => ({ value: target.id, label: target.name }))
	);

	let targetEntityId = $state<string | null>(targets[0]?.id ?? null);
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
	<p class="text-label text-muted">
		{t.disclaimer}
	</p>
	<div class="flex flex-col gap-1">
		<label for="table-note-target" class="font-mono text-label tracking-wide text-muted uppercase">
			{t.about}
		</label>
		<Combobox
			id="table-note-target"
			bind:value={targetEntityId}
			options={targetOptions}
			placeholder={t.about}
			searchPlaceholder={tControls.search}
			emptyText={tControls.noMatch}
		/>
	</div>
	<div class="flex flex-col gap-1">
		<label for="table-note-text" class="font-mono text-label tracking-wide text-muted uppercase">
			{t.note}
		</label>
		<Textarea id="table-note-text" bind:value={note} rows={3} placeholder={t.notePlaceholder} />
	</div>
	<div class="flex justify-end gap-2">
		<Button type="button" variant="secondary" onclick={onCancel}>
			{t.cancel}
		</Button>
		<Button type="submit" disabled={!targetEntityId || pending}>
			{pending ? t.savingAsProposal : t.saveAsProposal}
		</Button>
	</div>
</form>
