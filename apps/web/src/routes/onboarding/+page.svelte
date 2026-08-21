<script lang="ts">
	/**
	 * Issue #142, I4 = B ("one creation surface", docs/ux/DECISIONS.md): the only place a
	 * universe gets created now. Name the universe, then pick a start - import (D7's loud
	 * default, `?/import`, continues at /onboarding/import), start empty (`?/empty`, what
	 * /w/new used to do under its own URL), or derive from a pre-indexed universe
	 * (`?/preindexed`, honest about a "not configured" deployment rather than hiding the
	 * card). Signed-up accounts with zero universes land here straight from `/` (I1), so
	 * this is the shell's first screen, not a settings-adjacent form - no chrome of its
	 * own, Shell's root layout frames it.
	 */
	import { enhance } from '$app/forms';
	import { messages } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { PageHeader, PageBody } from '$lib/components/ui/page-header';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let t = $derived(messages(data.locale).import.start);

	// svelte-ignore state_referenced_locally
	let name = $state(form?.name ?? '');

	// One form, three `formaction` buttons - `submitter` (SvelteKit's enhance callback
	// param) says which one the reader actually pressed, so only that button relabels
	// itself while all three disable together (a second click cannot fire a different
	// start while the first is still running).
	let submittingKind = $state<'import' | 'empty' | 'preindexed' | null>(null);
</script>

<svelte:head>
	<title>{t.headTitle}</title>
</svelte:head>

<PageHeader title={t.heading} description={t.description} />
<PageBody width="working">
	<div class="flex flex-col gap-6">

	{#if form?.error}
		<p class="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{form.error}</p>
	{/if}

	<form
		method="POST"
		class="flex flex-col gap-6"
		use:enhance={({ submitter }) => {
			const action = submitter?.getAttribute('formaction');
			submittingKind =
				action === '?/import'
					? 'import'
					: action === '?/empty'
						? 'empty'
						: action === '?/preindexed'
							? 'preindexed'
							: null;
			return async ({ update }) => {
				await update();
				submittingKind = null;
			};
		}}
	>
		<div class="flex max-w-sm flex-col gap-1.5">
			<Label for="name">{t.nameLabel}</Label>
			<Input id="name" name="name" bind:value={name} placeholder={t.namePlaceholder} required />
		</div>

		<div class="grid gap-4 sm:grid-cols-3">
			<div class="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4">
				<h2 class="text-sm font-medium text-ink">{t.importCard.heading}</h2>
				<p class="flex-1 text-sm text-ink-2">{t.importCard.description}</p>
				<Button
					type="submit"
					formaction="?/import"
					class="self-start"
					disabled={submittingKind !== null}
				>
					{submittingKind === 'import' ? t.creating : t.importCard.cta}
				</Button>
			</div>

			<div class="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4">
				<h2 class="text-sm font-medium text-ink">{t.emptyCard.heading}</h2>
				<p class="flex-1 text-sm text-ink-2">{t.emptyCard.description}</p>
				<Button
					type="submit"
					formaction="?/empty"
					variant="secondary"
					class="self-start"
					disabled={submittingKind !== null}
				>
					{submittingKind === 'empty' ? t.creating : t.emptyCard.cta}
				</Button>
			</div>

			<div class="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4">
				{#if data.preIndexedBase}
					<h2 class="text-sm font-medium text-ink">
						{t.preindexedCard.heading(data.preIndexedBase.name)}
					</h2>
					<p class="flex-1 text-sm text-ink-2">{t.preindexedCard.description}</p>
					<Button
						type="submit"
						formaction="?/preindexed"
						variant="secondary"
						class="self-start"
						disabled={submittingKind !== null}
					>
						{submittingKind === 'preindexed'
							? t.creating
							: t.preindexedCard.cta(data.preIndexedBase.name)}
					</Button>
				{:else}
					<h2 class="text-sm font-medium text-ink">{t.preindexedCard.genericHeading}</h2>
					<p class="text-sm text-muted">{t.preindexedCard.notConfigured}</p>
				{/if}
			</div>
		</div>
	</form>
	</div>
</PageBody>
