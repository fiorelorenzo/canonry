<script lang="ts">
	/**
	 * Email and password plus whichever social providers `$lib/server/auth.ts`
	 * actually configured (issue #86). Runs client-side against `authClient` so the
	 * redirect and the session refresh happen in one place after either path
	 * succeeds - `invalidateAll` re-runs every load, which is what makes the shell
	 * pick up `locals.user` on the very next render without a full page reload.
	 */
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import Mark from '$lib/components/brand/Mark.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

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
		const { error: signInError } = await authClient.signIn.email({ email, password });
		submitting = false;
		if (signInError) {
			error = signInError.message ?? 'Could not sign in.';
			return;
		}
		await invalidateAll();
		await goto(resolve('/'));
	}

	async function signInWithProvider(provider: string) {
		error = null;
		const { error: signInError } = await authClient.signIn.social({
			provider,
			callbackURL: resolve('/')
		});
		if (signInError) error = signInError.message ?? `Could not start ${provider} sign-in.`;
	}
</script>

<svelte:head>
	<title>Sign in: Canonry</title>
</svelte:head>

<main id="main" class="mx-auto flex max-w-measure flex-col gap-6 px-8 py-16">
	<div>
		<div class="mb-4 flex items-center gap-1.5 text-accent">
			<Mark size={18} />
			<span class="text-sm font-semibold tracking-wide text-ink-2">Canonry</span>
		</div>
		<h1 class="text-2xl font-semibold text-ink">Sign in</h1>
		<p class="mt-2 text-sm text-ink-2">Your universes, your account, nobody else's.</p>
	</div>

	{#if data.providers.length > 0}
		<div class="flex flex-col gap-2">
			{#each data.providers as provider (provider)}
				<button
					type="button"
					onclick={() => signInWithProvider(provider)}
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
				autocomplete="current-password"
				required
				bind:value={password}
				class="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink"
			/>
		</label>

		<button
			type="submit"
			disabled={submitting}
			class="mt-2 w-fit rounded-md bg-accent px-4 py-2 text-sm font-medium text-panel hover:bg-accent-ink disabled:opacity-60"
		>
			{submitting ? 'Signing in…' : 'Sign in'}
		</button>

		{#if error}
			<p class="text-sm text-danger">{error}</p>
		{/if}
	</form>

	<p class="text-sm text-ink-2">
		No account yet? <a href={resolve('/auth/sign-up')} class="text-accent hover:underline"
			>Sign up</a
		>
	</p>
</main>
