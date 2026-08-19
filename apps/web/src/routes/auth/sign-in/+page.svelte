<script lang="ts">
	/**
	 * Email and password plus whichever social providers `$lib/server/auth.ts`
	 * actually configured (issue #86). Runs client-side against `authClient` so the
	 * redirect and the session refresh happen in one place after either path
	 * succeeds - `invalidateAll` re-runs every load, which is what makes the shell
	 * pick up `locals.user` on the very next render without a full page reload.
	 *
	 * The title page (I2 = C, #139): AuthShell owns the frame, mark, subtitle and
	 * footer rule; this file owns only the form that sits inside it. No `pane` prop
	 * - the argument pane is sign-up's, since a visitor signing back in is already
	 * sold (docs/ux/product-pass.html#i2's own cost note against showing it here).
	 */
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { messages } from '$lib/i18n';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const t = $derived(messages(data.locale).auth.signIn);

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
	<title>{t.title}: Canonry</title>
</svelte:head>

<AuthShell locale={data.locale} subtitle={t.subtitle}>
	{#if data.providers.length > 0}
		<div class="flex flex-col gap-2">
			{#each data.providers as provider (provider)}
				<Button
					type="button"
					variant="secondary"
					class="w-full"
					onclick={() => signInWithProvider(provider)}
				>
					{t.continueWith(PROVIDER_DISPLAY_NAME[provider] ?? provider)}
				</Button>
			{/each}
		</div>
		<div class="my-4 flex items-center gap-3 text-xs tracking-wide text-muted uppercase">
			<span class="h-px flex-1 bg-line"></span>
			{t.orDivider}
			<span class="h-px flex-1 bg-line"></span>
		</div>
	{/if}

	<form onsubmit={submit} class="flex flex-col gap-4">
		<div class="flex flex-col gap-1.5">
			<Label for="email">{t.emailLabel}</Label>
			<Input
				id="email"
				type="email"
				name="email"
				autocomplete="email"
				required
				bind:value={email}
			/>
		</div>
		<div class="flex flex-col gap-1.5">
			<Label for="password">{t.passwordLabel}</Label>
			<Input
				id="password"
				type="password"
				name="password"
				autocomplete="current-password"
				required
				bind:value={password}
			/>
			<a href={resolve('/auth/forgot-password')} class="text-sm text-accent hover:underline">
				{t.forgotPasswordLink}
			</a>
		</div>

		<Button type="submit" disabled={submitting} class="mt-2 w-full">
			{submitting ? t.submitting : t.submit}
		</Button>

		{#if error}
			<p role="alert" class="text-sm text-danger">{error}</p>
		{/if}
	</form>

	<p class="mt-4 text-center text-sm text-ink-2">
		{t.noAccount}
		<a href={resolve('/auth/sign-up')} class="text-accent hover:underline">{t.signUpLink}</a>
	</p>
</AuthShell>
