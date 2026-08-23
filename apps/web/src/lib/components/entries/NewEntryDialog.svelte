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
	import * as Select from '$lib/components/ui/select';
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

	// Dialog content unmounts on close (bits-ui, no forceMount), so a fresh instance -
	// and a fresh default - is what a reopen gets, same as the browser resetting a plain
	// <select> to its first option each time.
	let entityType = $state<string>(BROWSABLE_TYPES[0]);
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
				<Select.Root type="single" name="type" bind:value={entityType}>
					<Select.Trigger id="new-entry-type" class="w-full">
						{t.filters.typeLabel(entityType)}
					</Select.Trigger>
					<Select.Content>
						{#each BROWSABLE_TYPES as type (type)}
							<Select.Item value={type} label={t.filters.typeLabel(type)}>
								{t.filters.typeLabel(type)}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			{#if error}
				<p class="text-body text-danger">{error}</p>
			{/if}
			<DialogFooter>
				<Button type="submit">{t.newEntryDialog.submit}</Button>
			</DialogFooter>
		</form>
	</DialogContent>
</Dialog>
