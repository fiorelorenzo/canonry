<script lang="ts">
	/**
	 * `/auth/reset-password` (#151): where the mail's link lands, `?token=<token>`
	 * appended by Better Auth's own `/api/auth/reset-password/:token` redirect (see
	 * `$lib/server/mail/reset-password.ts`'s doc comment for the request-password-reset
	 * side of this flow). `?error=INVALID_TOKEN` is the same redirect's answer for an
	 * expired or already-used token - treated the same as no token at all, since there is
	 * nothing this screen can do with either. Client-driven like sign-in/sign-up's own
	 * submit (`authClient.resetPassword`), not a server action: unlike the
	 * forgot-password screen, a failure here (an expired token, a password that is too
	 * short) is Better Auth's own real API error, never silently swallowed the way a
	 * transport failure is (`runInBackgroundOrAwait` only ever wraps `sendResetPassword`,
	 * never `resetPassword` itself).
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { messages } from '$lib/i18n';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const t = $derived(messages(data.locale).auth.resetPassword);
	const token = $derived(page.url.searchParams.get('token'));
	const linkInvalid = $derived(!token || page.url.searchParams.get('error') === 'INVALID_TOKEN');

	let newPassword = $state('');
	let confirmPassword = $state('');
	let error = $state<string | null>(null);
	let submitting = $state(false);
	let success = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		if (!token) return;
		if (newPassword !== confirmPassword) {
			error = t.passwordMismatch;
			return;
		}
		submitting = true;
		const { error: resetError } = await authClient.resetPassword({ newPassword, token });
		submitting = false;
		if (resetError) {
			error = resetError.message ?? t.invalidToken;
			return;
		}
		success = true;
	}
</script>

<svelte:head>
	<title>{t.title}: Canonry</title>
</svelte:head>

<AuthShell locale={data.locale} subtitle={t.subtitle}>
	{#if success}
		<p class="text-sm text-ink-2">{t.success}</p>
		<p class="mt-4 text-center text-sm text-ink-2">
			<a href={resolve('/auth/sign-in')} class="text-accent hover:underline">{t.signInLink}</a>
		</p>
	{:else if linkInvalid}
		<p class="text-sm text-danger">{t.invalidToken}</p>
		<p class="mt-4 text-center text-sm text-ink-2">
			<a href={resolve('/auth/forgot-password')} class="text-accent hover:underline"
				>{t.requestNewLink}</a
			>
		</p>
	{:else}
		<form onsubmit={submit} class="flex flex-col gap-4">
			<div class="flex flex-col gap-1.5">
				<Label for="new-password">{t.newPasswordLabel}</Label>
				<Input
					id="new-password"
					type="password"
					name="newPassword"
					autocomplete="new-password"
					required
					minlength={8}
					bind:value={newPassword}
				/>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="confirm-password">{t.confirmPasswordLabel}</Label>
				<Input
					id="confirm-password"
					type="password"
					name="confirmPassword"
					autocomplete="new-password"
					required
					minlength={8}
					bind:value={confirmPassword}
				/>
			</div>

			<Button type="submit" disabled={submitting} class="mt-2 w-full">
				{submitting ? t.submitting : t.submit}
			</Button>

			{#if error}
				<p role="alert" class="text-sm text-danger">{error}</p>
			{/if}
		</form>
	{/if}
</AuthShell>
