<script lang="ts">
	/**
	 * Issue #145 (I7 = C): "a New entry action, which this product does not have at all
	 * today." The smallest honest flow the issue names - a name and a type, then straight
	 * to the real editor - so this dialog writes nothing beyond `createEntity`
	 * (`@canonry/db`): no body, no revision, no `scheduleCanonSaveJob`. The editor's own
	 * first save (`e/[slug]/edit/+page.server.ts`) is guardrail 2's one write path for a
	 * body actually landing in canon; this dialog only ever gets a GM to that door.
	 *
	 * `open` is bindable rather than owning a trigger itself, because two separate
	 * buttons open the same dialog - the page header's always-visible action and the
	 * cold empty state's action (I8's own contract: cold gets a primary action). One
	 * dialog instance, two openers, matching `open` state in the parent page.
	 */
	import { enhance } from '$app/forms';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import type { EntityType } from '@canonry/db/schema';
	import type { Messages } from '$lib/i18n';

	const BROWSABLE_TYPES: EntityType[] = ['character', 'place', 'faction', 'event', 'item'];

	let {
		open = $bindable(false),
		error,
		t
	}: {
		open?: boolean;
		error?: string;
		t: Messages['universe']['index'];
	} = $props();
</script>

<Dialog bind:open>
	<DialogContent closeLabel={t.newEntryDialog.cancel}>
		<DialogHeader>
			<DialogTitle>{t.newEntryDialog.title}</DialogTitle>
			<DialogDescription>{t.newEntryDialog.description}</DialogDescription>
		</DialogHeader>
		<form method="POST" action="?/createEntry" class="flex flex-col gap-4" use:enhance>
			<div class="flex flex-col gap-1.5">
				<Label for="new-entry-name">{t.newEntryDialog.nameLabel}</Label>
				<Input id="new-entry-name" name="name" required />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="new-entry-type">{t.newEntryDialog.typeLabel}</Label>
				<select
					id="new-entry-type"
					name="type"
					class="h-9 rounded-md border border-input bg-transparent px-2.5 py-1 text-sm text-ink shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
				>
					{#each BROWSABLE_TYPES as type (type)}
						<option value={type}>{t.filters.typeLabel(type)}</option>
					{/each}
				</select>
			</div>
			{#if error}
				<p class="text-sm text-danger">{error}</p>
			{/if}
			<DialogFooter>
				<Button type="submit">{t.newEntryDialog.submit}</Button>
			</DialogFooter>
		</form>
	</DialogContent>
</Dialog>
