<script lang="ts">
	/**
	 * Mirrors `/auth/sign-in`'s shape - see that page's doc comment for the redirect. `name`
	 * is required: `user.name` is `notNull()` in the schema Better Auth owns
	 * (packages/db/src/schema/auth.ts).
	 *
	 * The split (I2 = B, #139): the same AuthShell as sign-in, with `pane` set so
	 * the static argument pane renders beside the form at >=900px and drops below
	 * it (I2's own layout choice for this page).
	 *
	 * #262: the account is created by `?/signUp` in `+page.server.ts`, not by a client
	 * `authClient.signUp.email` call. What used to be here was `<form onsubmit={submit}>`
	 * with no `method` and no action behind it, so a submit before hydration was a GET to
	 * this URL with the name, the email and the password in the query string, and therefore
	 * in history, in a proxy log and in the next request's `Referer`. `method="post"` is
	 * what closes that: the browser posts with no JavaScript involved, and `use:enhance` is
	 * the enhancement on top - it keeps the same single-page feel the client call had,
	 * because applying a `redirect` result is a `goto` that invalidates every load.
	 *
	 * The social buttons stay on `authClient`: they are `type="button"` with an `onclick`,
	 * they submit no form, and they carry no field, so no value of theirs can reach a URL.
	 */
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { messages } from '$lib/i18n';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const t = $derived(messages(data.locale).auth.signUp);

	let providerError = $state<string | null>(null);
	let submitting = $state(false);

	// Brand names, never translated - same rule SPEC.md §17 states for a canon entity's
	// name, applied here to a product's own.
	const PROVIDER_DISPLAY_NAME: Record<string, string> = {
		github: 'GitHub',
		google: 'Google'
	};

	async function signUpWithProvider(provider: string) {
		providerError = null;
		const { error: signInError } = await authClient.signIn.social({
			provider,
			callbackURL: resolve('/')
		});
		if (signInError) providerError = signInError.message ?? `Could not start ${provider} sign-in.`;
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
		{#if providerError}
			<p role="alert" class="mt-2 text-sm text-danger">{providerError}</p>
		{/if}
		<div class="my-4 flex items-center gap-3 text-xs tracking-wide text-muted uppercase">
			<span class="h-px flex-1 bg-line"></span>
			{t.orDivider}
			<span class="h-px flex-1 bg-line"></span>
		</div>
	{/if}

	<form
		method="post"
		action="?/signUp"
		class="flex flex-col gap-4"
		use:enhance={() => {
			providerError = null;
			submitting = true;
			// `reset: false`: a rejected sign-up should not empty the fields the reader just
			// filled in. The password is not among the values the action sends back, so what
			// survives here is the DOM's own state, never something re-rendered from a payload.
			return async ({ update }) => {
				await update({ reset: false });
				submitting = false;
			};
		}}
	>
		<div class="flex flex-col gap-1.5">
			<Label for="name">{t.nameLabel}</Label>
			<Input
				id="name"
				type="text"
				name="name"
				autocomplete="name"
				required
				value={form?.name ?? ''}
			/>
		</div>
		<div class="flex flex-col gap-1.5">
			<Label for="email">{t.emailLabel}</Label>
			<Input
				id="email"
				type="email"
				name="email"
				autocomplete="email"
				required
				value={form?.email ?? ''}
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
			/>
		</div>

		<Button type="submit" disabled={submitting} class="mt-2 w-full">
			{submitting ? t.submitting : t.submit}
		</Button>

		{#if form?.error}
			<p role="alert" class="text-sm text-danger">{form.error}</p>
		{/if}
	</form>

	<p class="mt-4 text-center text-sm text-ink-2">
		{t.haveAccount}
		<a
			href={resolve('/auth/sign-in')}
			class="text-accent underline decoration-line-2 underline-offset-2">{t.signInLink}</a
		>
	</p>
</AuthShell>
