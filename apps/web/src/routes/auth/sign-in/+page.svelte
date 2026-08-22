<script lang="ts">
	/**
	 * Email and password plus whichever social providers `$lib/server/auth.ts`
	 * actually configured (issue #86).
	 *
	 * The title page (I2 = C, #139): AuthShell owns the frame, mark, subtitle and
	 * footer rule; this file owns only the form that sits inside it. No `pane` prop
	 * - the argument pane is sign-up's, since a visitor signing back in is already
	 * sold (docs/ux/product-pass.html#i2's own cost note against showing it here).
	 *
	 * #262: the session is created by `?/signIn` in `+page.server.ts`, not by a client
	 * `authClient.signIn.email` call. This was `<form onsubmit={submit}>` with no `method`,
	 * so a submit before hydration was a GET to this URL with the email and the password in
	 * the query string. `method="post"` is what closes that, with no JavaScript involved,
	 * and `use:enhance` keeps the redirect and the session refresh happening in one place
	 * afterwards: applying a `redirect` result is a `goto` that invalidates every load,
	 * which is what makes the shell pick up `locals.user` on the very next render.
	 *
	 * The social buttons stay on `authClient`: `type="button"` with an `onclick`, no form
	 * submit and no field of their own, so nothing of theirs can reach a URL.
	 */
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { InlineLink } from '$lib/components/ui/link';
	import { messages } from '$lib/i18n';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const t = $derived(messages(data.locale).auth.signIn);

	let providerError = $state<string | null>(null);
	let submitting = $state(false);

	// Brand names, never translated - same rule SPEC.md §17 states for a canon entity's
	// name, applied here to a product's own.
	const PROVIDER_DISPLAY_NAME: Record<string, string> = {
		github: 'GitHub',
		google: 'Google'
	};

	async function signInWithProvider(provider: string) {
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

<AuthShell locale={data.locale} title={t.title} subtitle={t.subtitle}>
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
		action="?/signIn"
		class="flex flex-col gap-4"
		use:enhance={() => {
			providerError = null;
			submitting = true;
			// `reset: false`: a wrong password should not also empty the email field. The
			// password is not among the values the action sends back, so what survives here is
			// the DOM's own state, never something re-rendered from a payload.
			return async ({ update }) => {
				await update({ reset: false });
				submitting = false;
			};
		}}
	>
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
				autocomplete="current-password"
				required
			/>
			<InlineLink href={resolve('/auth/forgot-password')} class="text-sm">
				{t.forgotPasswordLink}
			</InlineLink>
		</div>

		<Button type="submit" disabled={submitting} class="mt-2 w-full">
			{submitting ? t.submitting : t.submit}
		</Button>

		{#if form?.error}
			<p role="alert" class="text-sm text-danger">{form.error}</p>
		{/if}
	</form>

	<p class="mt-4 text-center text-sm text-ink-2">
		{t.noAccount}
		<InlineLink href={resolve('/auth/sign-up')}>{t.signUpLink}</InlineLink>
	</p>
</AuthShell>
