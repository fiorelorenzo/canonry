<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

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

	const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

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
	<title>API keys — Canonry</title>
</svelte:head>

<main id="main" class="mx-auto max-w-measure px-8 py-10">
	<a href={resolve('/')} class="text-sm text-accent hover:underline">&larr; Universes</a>

	<h1 class="mt-4 text-2xl font-semibold text-ink">API keys</h1>

	<!-- F3 = C's contextual sentence, in its B home (docs/ux/f3-privacy-and-keys.html: "C for
	     the sentence itself... every one-liner links to B, the settings panel"). Says plainly
	     what turning a key on changes and what it does not (SPEC.md §15, decision F3). -->
	<div class="mt-4 max-w-xl rounded-lg border border-line-2 bg-panel-2 p-4 text-sm text-ink-2">
		<p class="mt-0">
			Bring your own key to use your own provider account instead of ours. <strong class="text-ink"
				>Off by default, for every provider, until you add one</strong
			> - SPEC.md §15 never makes this the default path.
		</p>
		<p class="mt-3 mb-0">
			<strong class="text-ink">What changes:</strong> a call routed on your key stops drawing on your
			included quota or your warm budget, and your own provider's rate limits apply instead of ours.
		</p>
		<p class="mt-2 mb-0">
			<strong class="text-ink">What does not:</strong> model routing is unchanged (the same
			cheap-model-for-candidates, premium-for-diffs split runs on your key exactly as on ours), the
			call still goes through our gateway so logging and cost accounting stay uniform, and generated
			content still carries the same authorship marking and the same privacy rules regardless of
			whose key paid for it.
			<a href={resolve('/privacy')} class="text-accent hover:underline">Full policy</a>.
		</p>
	</div>

	{#if !data.signedIn}
		<p class="mt-6 max-w-measure text-sm text-ink-2">
			<a href={resolve('/auth/sign-in')} class="text-accent hover:underline">Sign in</a> to configure
			a key.
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
							<span
								class="rounded-full px-2 py-0.5 text-xs font-medium"
								class:bg-accent-bg={key.active}
								class:text-accent-ink={key.active}
								class:bg-panel-2={!key.active}
								class:text-muted={!key.active}
							>
								{key.active ? 'Active' : 'Off'}
							</span>
						{/if}
					</div>

					{#if key}
						<div class="mt-2 flex flex-wrap items-center gap-2 font-mono text-xs text-ink-2">
							<span
								class="rounded border border-line-2 bg-panel-2 px-2 py-1"
								aria-label="Key ending in {key.lastFour}"
							>
								&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;{key.lastFour}
							</span>
							<span class="text-muted">
								added {dateFormat.format(new Date(key.createdAt))}
								{#if key.lastUsedAt}
									&middot; last used {dateFormat.format(new Date(key.lastUsedAt))}
								{:else}
									&middot; never used yet
								{/if}
							</span>
						</div>

						<div class="mt-3 flex flex-wrap gap-2">
							<form method="POST" action="?/toggle">
								<input type="hidden" name="provider" value={provider} />
								<input type="hidden" name="active" value={key.active ? 'false' : 'true'} />
								<button
									type="submit"
									class="rounded-md border border-line-2 px-3 py-1.5 text-sm text-ink hover:border-accent"
								>
									{key.active ? 'Turn off' : 'Turn on'}
								</button>
							</form>
							<form method="POST" action="?/remove">
								<input type="hidden" name="provider" value={provider} />
								<button
									type="submit"
									class="rounded-md border border-line-2 px-3 py-1.5 text-sm text-danger hover:border-danger"
								>
									Forget this key
								</button>
							</form>
						</div>
					{/if}

					<form method="POST" action="?/add" class="mt-3 flex flex-wrap items-end gap-2">
						<input type="hidden" name="provider" value={provider} />
						<label class="flex flex-1 flex-col gap-1">
							<span class="text-xs text-muted">{key ? 'Replace key' : 'Add key'}</span>
							<input
								type="password"
								name="apiKey"
								autocomplete="off"
								placeholder="{labelFor(provider)} API key"
								class="min-w-0 rounded border border-line-2 bg-panel px-2 py-1.5 text-sm text-ink"
							/>
						</label>
						<button
							type="submit"
							class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-panel hover:bg-accent-ink"
						>
							{key ? 'Replace' : 'Save'}
						</button>
					</form>

					{#if errorHere}
						<p class="mt-2 text-xs text-danger">{errorHere}</p>
					{:else if lastFourHere}
						<p class="mt-2 text-xs text-ok">
							Saved - only the last four characters (&hellip;{lastFourHere}) are ever shown again.
						</p>
					{/if}
				</section>
			{/each}
		</div>
	{/if}
</main>
