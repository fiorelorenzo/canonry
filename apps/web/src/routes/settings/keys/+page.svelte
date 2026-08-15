<script lang="ts">
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { PageHeader } from '$lib/components/ui/page-header';
	import { dateFormat, messages } from '$lib/i18n';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let t = $derived(messages(data.locale).settings.keys);

	// Provider names (OpenAI, Anthropic, Google, Groq, Mistral) are proper nouns and stay
	// out of the catalogue.
	const PROVIDER_LABEL: Record<string, string> = {
		openai: 'OpenAI',
		anthropic: 'Anthropic',
		google: 'Google',
		groq: 'Groq',
		mistral: 'Mistral'
	};

	function labelFor(provider: string): string {
		return PROVIDER_LABEL[provider] ?? provider;
	}

	let keyDateFormat = $derived(
		dateFormat(data.locale, { dateStyle: 'medium', timeStyle: 'short' })
	);

	function keyFor(provider: string) {
		return data.signedIn ? data.keys.find((key) => key.provider === provider) : undefined;
	}

	/** SvelteKit's `ActionData` is a union across every action's fail()/success shape -
	 * `add`'s `{error}` and `toggle`'s `{toggled, active}` do not share a discriminant
	 * TypeScript can narrow on cleanly. This reads a field at runtime instead of leaning
	 * on control-flow narrowing that would otherwise collapse to `never` for a shape the
	 * compiler cannot prove is the one currently present. */
	function fieldOf(candidate: unknown, key: string): unknown {
		return candidate && typeof candidate === 'object' && key in candidate
			? (candidate as Record<string, unknown>)[key]
			: undefined;
	}
</script>

<svelte:head>
	<title>{t.title}: Canonry</title>
</svelte:head>

<PageHeader title={t.title} />

<!-- F3 = C's contextual sentence, in its B home (docs/ux/f3-privacy-and-keys.html: "C for
     the sentence itself... every one-liner links to B, the settings panel"). Says plainly
     what turning a key on changes and what it does not (SPEC.md §15, decision F3). -->
<div class="mt-4 max-w-xl rounded-lg border border-line-2 bg-panel-2 p-4 text-sm text-ink-2">
	<p class="mt-0">
		{t.infoPara1Before}<strong class="text-ink">{t.infoPara1Bold}</strong>{t.infoPara1After}
	</p>
	<p class="mt-3 mb-0">
		<strong class="text-ink">{t.infoPara2Bold}</strong>{t.infoPara2After}
	</p>
	<p class="mt-2 mb-0">
		<strong class="text-ink">{t.infoPara3Bold}</strong>{t.infoPara3After}
		<a href={resolve('/privacy')} class="text-accent hover:underline">{t.infoPara3Link}</a>.
	</p>
</div>

{#if !data.signedIn}
	<p class="mt-6 max-w-measure text-sm text-ink-2">
		<a href={resolve('/auth/sign-in')} class="text-accent hover:underline">{t.signInLink}</a>
		{t.signInPrompt}
	</p>
{:else}
	<div class="mt-8 flex flex-col gap-4">
		{#each data.providers as provider (provider)}
			{@const key = keyFor(provider)}
			{@const forThisProvider = form && fieldOf(form, 'provider') === provider ? form : null}
			{@const errorHere = forThisProvider
				? (fieldOf(forThisProvider, 'error') as string | undefined)
				: undefined}
			{@const lastFourHere = forThisProvider
				? (fieldOf(forThisProvider, 'lastFour') as string | undefined)
				: undefined}
			<section class="rounded-lg border border-line bg-panel p-4">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h2 class="text-base font-semibold text-ink">{labelFor(provider)}</h2>
					{#if key}
						<Badge variant={key.active ? 'default' : 'secondary'}>
							{key.active ? t.activeBadge : t.offBadge}
						</Badge>
					{/if}
				</div>

				{#if key}
					<div class="mt-2 flex flex-wrap items-center gap-2 font-mono text-xs text-ink-2">
						<span
							class="rounded border border-line-2 bg-panel-2 px-2 py-1"
							aria-label={t.keyEndingIn(key.lastFour)}
						>
							&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;{key.lastFour}
						</span>
						<span class="text-muted">
							{t.addedOn(keyDateFormat.format(new Date(key.createdAt)))}
							{#if key.lastUsedAt}
								&middot; {t.lastUsedOn(keyDateFormat.format(new Date(key.lastUsedAt)))}
							{:else}
								&middot; {t.neverUsedYet}
							{/if}
						</span>
					</div>

					<div class="mt-3 flex flex-wrap gap-2">
						<form method="POST" action="?/toggle">
							<input type="hidden" name="provider" value={provider} />
							<input type="hidden" name="active" value={key.active ? 'false' : 'true'} />
							<Button type="submit" variant="secondary" size="sm">
								{key.active ? t.turnOff : t.turnOn}
							</Button>
						</form>
						<form method="POST" action="?/remove">
							<input type="hidden" name="provider" value={provider} />
							<Button type="submit" variant="destructive" size="sm">{t.forgetKey}</Button>
						</form>
					</div>
				{/if}

				<form method="POST" action="?/add" class="mt-3 flex flex-wrap items-end gap-2">
					<input type="hidden" name="provider" value={provider} />
					<label class="flex flex-1 flex-col gap-1">
						<span class="text-xs text-muted">{key ? t.replaceKeyLabel : t.addKeyLabel}</span>
						<Input
							type="password"
							name="apiKey"
							autocomplete="off"
							placeholder={t.apiKeyPlaceholder(labelFor(provider))}
						/>
					</label>
					<Button type="submit" size="sm">{key ? t.replaceButton : t.saveButton}</Button>
				</form>

				{#if errorHere}
					<p class="mt-2 text-xs text-danger">{errorHere}</p>
				{:else if lastFourHere}
					<p class="mt-2 text-xs text-ok">
						{t.savedConfirmation(lastFourHere)}
					</p>
				{/if}
			</section>
		{/each}
	</div>
{/if}
