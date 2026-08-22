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

			<!-- V3 = B, and A1's reading room: three starts as rows with a rule between
			     them, not three bordered cards side by side. The card grid was the last
			     `sm:grid-cols-3` on a first-run screen, and at 1440 it cost the page
			     everything: three columns of `text-sm` crammed into the top third of the
			     viewport, while the same markup read well on a phone because it stacked.
			     Rows fill the width they are given, so the type can be the type this page
			     deserves - a `text-title` heading and a `text-body` sentence, the same pair
			     every pinned row and every entry row uses. The "not configured" start
			     stays visible rather than being hidden (I4 = B), and as a row it costs one
			     line instead of a third of the screen. -->
			<ul class="flex flex-col">
				<li class="flex flex-col gap-2 border-b border-line py-4 first:pt-0 last:border-b-0">
					<h2 class="text-title font-semibold text-ink">{t.importCard.heading}</h2>
					<p class="max-w-measure text-body text-ink-2">{t.importCard.description}</p>
					<Button
						type="submit"
						formaction="?/import"
						class="mt-1 self-start"
						disabled={submittingKind !== null}
					>
						{submittingKind === 'import' ? t.creating : t.importCard.cta}
					</Button>
				</li>

				<li class="flex flex-col gap-2 border-b border-line py-4 last:border-b-0">
					<h2 class="text-title font-semibold text-ink">{t.emptyCard.heading}</h2>
					<p class="max-w-measure text-body text-ink-2">{t.emptyCard.description}</p>
					<Button
						type="submit"
						formaction="?/empty"
						variant="secondary"
						class="mt-1 self-start"
						disabled={submittingKind !== null}
					>
						{submittingKind === 'empty' ? t.creating : t.emptyCard.cta}
					</Button>
				</li>

				<li class="flex flex-col gap-2 border-b border-line py-4 last:border-b-0">
					{#if data.preIndexedBase}
						<h2 class="text-title font-semibold text-ink">
							{t.preindexedCard.heading(data.preIndexedBase.name)}
						</h2>
						<p class="max-w-measure text-body text-ink-2">{t.preindexedCard.description}</p>
						<Button
							type="submit"
							formaction="?/preindexed"
							variant="secondary"
							class="mt-1 self-start"
							disabled={submittingKind !== null}
						>
							{submittingKind === 'preindexed'
								? t.creating
								: t.preindexedCard.cta(data.preIndexedBase.name)}
						</Button>
					{:else}
						<h2 class="text-title font-semibold text-ink">
							{t.preindexedCard.genericHeading}
						</h2>
						<p class="max-w-measure text-body text-muted">{t.preindexedCard.notConfigured}</p>
					{/if}
				</li>
			</ul>
		</form>
	</div>
</PageBody>
