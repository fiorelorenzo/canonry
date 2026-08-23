<script lang="ts">
	/**
	 * `/auth/account-deleted` (#154): the landing page after the emailed confirmation
	 * link actually deletes the account (`+page.server.ts`'s own doc comment). Same
	 * reading room shell as sign-in/sign-up/forgot-password/reset-password (`AuthShell`,
	 * I2, #139) - no form, no session check, the account it would check no longer exists.
	 */
	import { resolve } from '$app/paths';
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import { InlineLink } from '$lib/components/ui/link';
	import { messages } from '$lib/i18n';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const t = $derived(messages(data.locale).auth.accountDeleted);
</script>

<svelte:head>
	<title>{t.title}: Canonry</title>
</svelte:head>

<AuthShell locale={data.locale} title={t.title} subtitle={t.subtitle}>
	<p class="text-body text-ink-2">{t.body}</p>
	<p class="mt-4 text-center text-body text-ink-2">
		<InlineLink href={resolve('/')}>{t.homeLink}</InlineLink>
	</p>
</AuthShell>
