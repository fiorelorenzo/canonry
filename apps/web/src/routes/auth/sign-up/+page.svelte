<script lang="ts">
	/**
	 * Mirrors `/auth/sign-in`'s shape - see that page's doc comment for why the
	 * redirect and the session refresh both happen client-side after authClient
	 * resolves. `name` is required: `user.name` is `notNull()` in the schema Better
	 * Auth owns (packages/db/src/schema/auth.ts).
	 *
	 * The split (I2 = B, #139): the same AuthShell as sign-in, with `pane` set so
	 * the static argument pane renders beside the form at >=900px and drops below
	 * it (I2's own layout choice for this page).
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

<AuthShell locale={data.locale} subtitle={t.subtitle} pane>
	{#if data.providers.length > 0}
		<div class="flex flex-col gap-2">
			{#each data.providers as provider (provider)}
				<Button
					type="button"
					variant="secondary"
					class="w-full"
					onclick={() => signUpWithProvider(provider)}
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
			<Label for="name">{t.nameLabel}</Label>
			<Input id="name" type="text" name="name" autocomplete="name" required bind:value={name} />
		</div>
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
				autocomplete="new-password"
				required
				minlength={8}
				bind:value={password}
			/>
		</div>

		<Button type="submit" disabled={submitting} class="mt-2 w-full">
			{submitting ? t.submitting : t.submit}
		</Button>

		{#if error}
			<p role="alert" class="text-sm text-danger">{error}</p>
		{/if}
	</form>

	<p class="mt-4 text-center text-sm text-ink-2">
		{t.haveAccount}
		<a href={resolve('/auth/sign-in')} class="text-accent hover:underline">{t.signInLink}</a>
	</p>
</AuthShell>
