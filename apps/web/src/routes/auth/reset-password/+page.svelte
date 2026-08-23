<script lang="ts">
	/**
	 * `/auth/reset-password` (#151): where the mail's link lands, `?token=<token>`
	 * appended by Better Auth's own `/api/auth/reset-password/:token` redirect (see
	 * `$lib/server/mail/reset-password.ts`'s doc comment for the request-password-reset
	 * side of this flow). `?error=INVALID_TOKEN` is the same redirect's answer for an
	 * expired or already-used token - treated the same as no token at all, since there is
	 * nothing this screen can do with either.
	 *
	 * #262: the reset runs through `?/resetPassword` in `+page.server.ts`, not through a
	 * client `authClient.resetPassword` call. This was `<form onsubmit={submit}>` with no
	 * `method`, so a submit before hydration was a GET carrying `newPassword` and
	 * `confirmPassword` in the query string, on the one screen whose entire job is choosing
	 * a password. `method="post"` closes that with no JavaScript involved. Better Auth's
	 * real API error still reaches the reader: it arrives in the action as an `APIError` and
	 * comes back as `form.error`.
	 *
	 * The token travels twice, and both are load-bearing. It is a hidden field, so the action
	 * never depends on the query string surviving the POST, and it is also carried on the
	 * action URL (`?/resetPassword&token=...`, the same shape `/onboarding/import`'s actions
	 * already use), so a rejected POST re-renders *this* form with its error rather than the
	 * "expired link" branch. Without the second one the no-JavaScript path lands on a URL with
	 * no token, `linkInvalid` turns true, and a plain password mismatch reads as a dead link.
	 */
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { InlineLink } from '$lib/components/ui/link';
	import { messages } from '$lib/i18n';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const t = $derived(messages(data.locale).auth.resetPassword);
	const token = $derived(page.url.searchParams.get('token'));
	const linkInvalid = $derived(!token || page.url.searchParams.get('error') === 'INVALID_TOKEN');

	let submitting = $state(false);
</script>

<svelte:head>
	<title>{t.title}: Canonry</title>
</svelte:head>

<AuthShell locale={data.locale} title={t.title} subtitle={t.subtitle}>
	{#if form?.success}
		<p class="text-body text-ink-2">{t.success}</p>
		<p class="mt-4 text-center text-body text-ink-2">
			<InlineLink href={resolve('/auth/sign-in')}>{t.signInLink}</InlineLink>
		</p>
	{:else if linkInvalid}
		<p class="text-body text-danger">{t.invalidToken}</p>
		<p class="mt-4 text-center text-body text-ink-2">
			<InlineLink href={resolve('/auth/forgot-password')}>{t.requestNewLink}</InlineLink>
		</p>
	{:else}
		<form
			method="post"
			action="?/resetPassword&token={token}"
			class="flex flex-col gap-4"
			use:enhance={() => {
				submitting = true;
				// `reset: false`: a mismatch or a too-short password should not empty both fields.
				// Neither password is among the values the action sends back.
				return async ({ update }) => {
					await update({ reset: false });
					submitting = false;
				};
			}}
		>
			<input type="hidden" name="token" value={token} />
			<div class="flex flex-col gap-1.5">
				<Label for="new-password">{t.newPasswordLabel}</Label>
				<Input
					id="new-password"
					type="password"
					name="newPassword"
					autocomplete="new-password"
					required
					minlength={8}
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
				/>
			</div>

			<Button type="submit" disabled={submitting} class="mt-2 w-full">
				{submitting ? t.submitting : t.submit}
			</Button>

			{#if form?.error}
				<p role="alert" class="text-body text-danger">{form.error}</p>
			{/if}
		</form>
	{/if}
</AuthShell>
