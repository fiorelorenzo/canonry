<script lang="ts">
	/**
	 * `/auth/forgot-password` (#151): the request-a-reset screen, same reading room shell
	 * as sign-in/sign-up (`AuthShell`, I2, #139) rather than a second visual language for
	 * a screen that exists only because a password was forgotten. Its `+page.server.ts`
	 * action, not a client `authClient` call - see that file's own doc comment for why
	 * the loud-vs-silent-failure distinction only exists on the server.
	 */
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { messages } from '$lib/i18n';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const t = $derived(messages(data.locale).auth.forgotPassword);

	let submitting = $state(false);
</script>

<svelte:head>
	<title>{t.title}: Canonry</title>
</svelte:head>

<AuthShell locale={data.locale} title={t.title} subtitle={t.subtitle}>
	{#if form?.success}
		<p class="text-sm text-ink-2">{t.success}</p>
	{:else}
		<form
			method="POST"
			action="?/requestReset"
			class="flex flex-col gap-4"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
		>
			<div class="flex flex-col gap-1.5">
				<Label for="email">{t.emailLabel}</Label>
				<Input id="email" type="email" name="email" autocomplete="email" required />
			</div>

			<Button type="submit" disabled={submitting} class="mt-2 w-full">
				{submitting ? t.submitting : t.submit}
			</Button>

			{#if form?.error}
				<p role="alert" class="text-sm text-danger">{form.error}</p>
			{/if}
		</form>
	{/if}

	<p class="mt-4 text-center text-sm text-ink-2">
		<a href={resolve('/auth/sign-in')} class="text-accent hover:underline">{t.backToSignIn}</a>
	</p>
</AuthShell>
