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
	 * sentence never claims the canon is consistent. AppShell contributes no chrome
	 * when signed out, so this page builds its own top bar and owns `id="main"`.
	 *
	 * Signed in - issue #141, I3 = B: the universe picker inside the shell. Zero
	 * universes and exactly one both redirect before this ever renders
	 * (`+page.server.ts`, issue #140), so this branch only ever draws two or more.
	 */
	import { resolve } from '$app/paths';
	import Mark from '$lib/components/brand/Mark.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { PageHeader } from '$lib/components/ui/page-header';
	import { messages } from '$lib/i18n';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const t = $derived(messages(data.locale));
</script>

<svelte:head>
	<title>Canonry</title>
</svelte:head>

{#if !data.user}
	<div class="flex min-h-screen flex-col bg-paper">
		<div class="flex items-center gap-5 border-b border-line px-6 py-3 text-sm">
			<span class="flex-1"></span>
			<a href="https://canonry.io" class="text-ink-2 hover:text-accent">
				{t.auth.footer.whatCanonryIs}
			</a>
			<a href={resolve('/docs')} class="text-ink-2 hover:text-accent">{t.auth.footer.docs}</a>
			<a href={resolve('/privacy')} class="text-ink-2 hover:text-accent">{t.auth.footer.privacy}</a>
			<Button href={resolve('/auth/sign-in')} variant="secondary" size="sm">
				{t.shell.signIn}
			</Button>
			<Button href={resolve('/auth/sign-up')} size="sm">{t.shell.door.createAccount}</Button>
		</div>
		<main id="main" class="flex-1 px-8 py-12">
			<div class="max-w-measure">
				<div class="flex items-center gap-2 text-2xl font-semibold text-ink">
					<span class="text-accent"><Mark size={28} /></span>
					Canonry
				</div>
				<p class="mt-3 text-lg text-ink-2">{t.shell.tagline}</p>
				<div class="mt-5 flex gap-2">
					<Button href={resolve('/auth/sign-up')}>{t.shell.door.createAccount}</Button>
					<Button href={resolve('/auth/sign-in')} variant="secondary">{t.shell.signIn}</Button>
				</div>
				<p class="mt-6 text-sm text-muted">{t.shell.door.exportNote}</p>
			</div>
		</main>
	</div>
{:else}
	<div class="flex flex-col gap-6">
		<PageHeader title={t.universe.list.heading}>
			{#snippet actions()}
				<Button href={resolve('/onboarding')}>{t.universe.list.newUniverse}</Button>
			{/snippet}
		</PageHeader>

		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each data.universes as universe (universe.id)}
				<a
					href={resolve(`/u/${universe.slug}`)}
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
	</div>
{/if}
