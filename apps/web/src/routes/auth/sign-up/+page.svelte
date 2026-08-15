<script lang="ts">
	/** Mirrors `/auth/sign-in`'s shape - see that page's doc comment for why the
	 * redirect and the session refresh both happen client-side after authClient
	 * resolves. `name` is required: `user.name` is `notNull()` in the schema Better
	 * Auth owns (packages/db/src/schema/auth.ts). */
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import Mark from '$lib/components/brand/Mark.svelte';
	import LocaleSwitcher from '$lib/components/auth/LocaleSwitcher.svelte';
	import { messages } from '$lib/i18n';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const t = $derived(messages(data.locale).auth.signUp);

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let error = $state<string | null>(null);
	let submitting = $state(false);

	// Brand names, never translated - same rule SPEC.md §17 states for a canon entity's
	// name, applied here to a product's own.
	const PROVIDER_DISPLAY_NAME: Record<string, string> = {
		github: 'GitHub',
		google: 'Google'
	};

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		submitting = true;
		const { error: signUpError } = await authClient.signUp.email({ name, email, password });
		submitting = false;
		if (signUpError) {
			error = signUpError.message ?? 'Could not create an account.';
			return;
		}
		await invalidateAll();
		await goto(resolve('/'));
	}

	async function signUpWithProvider(provider: string) {
		error = null;
		const { error: signInError } = await authClient.signIn.social({
			provider,
			callbackURL: resolve('/')
		});
		if (signInError) error = signInError.message ?? `Could not start ${provider} sign-in.`;
	}
</script>

<svelte:head>
	<title>{t.title}: Canonry</title>
</svelte:head>

<main id="main" class="mx-auto flex max-w-measure flex-col gap-6 px-8 py-16">
	<div class="flex items-start justify-between gap-4">
		<div>
			<div class="mb-4 flex items-center gap-1.5 text-accent">
				<Mark size={18} />
				<span class="text-sm font-semibold tracking-wide text-ink-2">Canonry</span>
			</div>
			<h1 class="text-2xl font-semibold text-ink">{t.title}</h1>
			<p class="mt-2 text-sm text-ink-2">{t.subtitle}</p>
		</div>
		<LocaleSwitcher locale={data.locale} />
	</div>

	{#if data.providers.length > 0}
		<div class="flex flex-col gap-2">
			{#each data.providers as provider (provider)}
				<button
					type="button"
					onclick={() => signUpWithProvider(provider)}
					class="rounded-md border border-line bg-panel px-4 py-2 text-sm font-medium text-ink hover:border-accent"
				>
					{t.continueWith(PROVIDER_DISPLAY_NAME[provider] ?? provider)}
				</button>
			{/each}
		</div>
		<div class="flex items-center gap-3 text-xs tracking-wide text-muted uppercase">
			<span class="h-px flex-1 bg-line"></span>
			{t.orDivider}
			<span class="h-px flex-1 bg-line"></span>
		</div>
	{/if}

	<form onsubmit={submit} class="flex flex-col gap-3">
		<label class="flex flex-col gap-1 text-sm text-ink-2">
			{t.nameLabel}
			<input
				type="text"
				name="name"
				autocomplete="name"
				required
				bind:value={name}
				class="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"
			/>
		</label>
		<label class="flex flex-col gap-1 text-sm text-ink-2">
			{t.emailLabel}
			<input
				type="email"
				name="email"
				autocomplete="email"
				required
				bind:value={email}
				class="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"
			/>
		</label>
		<label class="flex flex-col gap-1 text-sm text-ink-2">
			{t.passwordLabel}
			<input
				type="password"
				name="password"
				autocomplete="new-password"
				required
				minlength={8}
				bind:value={password}
				class="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"
			/>
		</label>

		<button
			type="submit"
			disabled={submitting}
			class="mt-2 w-fit rounded-md bg-accent px-4 py-2 text-sm font-medium text-panel hover:bg-accent-ink disabled:opacity-60"
		>
			{submitting ? t.submitting : t.submit}
		</button>

		{#if error}
			<p class="text-sm text-danger">{error}</p>
		{/if}
	</form>

	<p class="text-sm text-ink-2">
		{t.haveAccount}
		<a href={resolve('/auth/sign-in')} class="text-accent hover:underline">{t.signInLink}</a>
	</p>
</main>
