<script lang="ts">
	/** Mirrors `/auth/sign-in`'s shape - see that page's doc comment for why the
	 * redirect and the session refresh both happen client-side after authClient
	 * resolves. `name` is required: `user.name` is `notNull()` in the schema Better
	 * Auth owns (packages/db/src/schema/auth.ts). */
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let error = $state<string | null>(null);
	let submitting = $state(false);

	const PROVIDER_LABEL: Record<string, string> = {
		github: 'Continue with GitHub',
		google: 'Continue with Google'
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
	<title>Sign up: Canonry</title>
</svelte:head>

<main id="main" class="mx-auto flex max-w-measure flex-col gap-6 px-8 py-16">
	<div>
		<h1 class="text-2xl font-semibold text-ink">Sign up</h1>
		<p class="mt-2 text-sm text-ink-2">One account, your own universes.</p>
	</div>

	{#if data.providers.length > 0}
		<div class="flex flex-col gap-2">
			{#each data.providers as provider (provider)}
				<button
					type="button"
					onclick={() => signUpWithProvider(provider)}
					class="rounded-md border border-line bg-panel px-4 py-2 text-sm font-medium text-ink hover:border-accent"
				>
					{PROVIDER_LABEL[provider] ?? `Continue with ${provider}`}
				</button>
			{/each}
		</div>
		<div class="flex items-center gap-3 text-xs tracking-wide text-muted uppercase">
			<span class="h-px flex-1 bg-line"></span>
			or
			<span class="h-px flex-1 bg-line"></span>
		</div>
	{/if}

	<form onsubmit={submit} class="flex flex-col gap-3">
		<label class="flex flex-col gap-1 text-sm text-ink-2">
			Name
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
			Email
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
			Password
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
			{submitting ? 'Creating account…' : 'Sign up'}
		</button>

		{#if error}
			<p class="text-sm text-danger">{error}</p>
		{/if}
	</form>

	<p class="text-sm text-ink-2">
		Already have an account? <a href={resolve('/auth/sign-in')} class="text-accent hover:underline"
			>Sign in</a
		>
	</p>
</main>
