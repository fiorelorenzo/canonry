<script lang="ts">
	/**
	 * `/`.
	 *
	 * Signed out - issue #138, I1 = B: the door. The mark, the app's own tagline
	 * sentence (the same catalogue entry `routes/+layout.svelte` ships as its meta
	 * description, already through guardrail 7), Create an account and Sign in as the
	 * two actions, and the three links a visitor is owed. Not a second landing page:
	 * the real pitch ships from canonry-landing at canonry.io (DECISIONS.md round
	 * four), so this grows no demo, no feature list, no pricing table, and its own
	 * sentence never claims the canon is consistent.
	 *
	 * Issue #490: this used to build its own top bar and its own centred block,
	 * which pinned the content to the top-left corner at 1440 and overflowed
	 * horizontally at 390 (the bar's five items in one `flex` row with no wrap).
	 * I2 (#139) already gave the two auth pages beside this one a title page -
	 * full paper, the mark centred, a narrow column under it, the secondary links
	 * in a footer rule - so the door now renders through that same `AuthShell`
	 * rather than composing its own frame a second time. AppShell contributes no
	 * chrome when signed out either way; `AuthShell` owns `id="main"`.
	 *
	 * Signed in - issue #141, I3 = B: the universe picker inside the shell. Zero
	 * universes and exactly one both redirect before this ever renders
	 * (`+page.server.ts`, issue #140), so this branch only ever draws two or more.
	 */
	import { resolve } from '$app/paths';
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Page } from '$lib/components/ui/page';
	import { messages } from '$lib/i18n';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const t = $derived(messages(data.locale));
</script>

<svelte:head>
	<title>Canonry</title>
</svelte:head>

{#if !data.user}
	<AuthShell locale={data.locale} title="Canonry" subtitle={t.shell.tagline}>
		<div class="flex flex-wrap justify-center gap-2">
			<Button href={resolve('/auth/sign-up')}>{t.shell.door.createAccount}</Button>
			<Button href={resolve('/auth/sign-in')} variant="secondary">{t.shell.signIn}</Button>
		</div>
		<p class="mt-4 text-center text-sm text-muted">{t.shell.door.exportNote}</p>
	</AuthShell>
{:else}
	<Page width="wide" title={t.universe.list.heading}>
		{#snippet actions()}
			<Button href={resolve('/onboarding')}>{t.universe.list.newUniverse}</Button>
		{/snippet}

		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each data.universes as universe (universe.id)}
				<a
					href={resolve(`/w/${universe.slug}`)}
					class="rounded-lg border border-line bg-panel p-4 hover:border-accent"
				>
					<div class="flex items-center gap-2">
						<span class="font-semibold text-ink">{universe.name}</span>
						<Badge variant="secondary" class="uppercase">{universe.kind}</Badge>
					</div>
					<p class="mt-1 text-sm text-ink-2">
						{#if universe.baseUniverseName}
							{t.universe.switcher.derivedFrom(universe.baseUniverseName)} &middot;
						{/if}
						{t.universe.switcher.entryCount(universe.entityCount)}
					</p>
				</a>
			{/each}
		</div>
	</Page>
{/if}
