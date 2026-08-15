<script lang="ts">
	/**
	 * Shown on every page (root `+layout.svelte`): who is signed in, or a way to sign
	 * in - issue #86's "the shell shows the signed-in user". Sign out goes through the
	 * client so the session cookie clears and the shell's own data (this component's
	 * `user` prop) refreshes in the same navigation, rather than linking to
	 * `/auth/sign-out` and relying on its own onMount round trip.
	 *
	 * `signedInAs` is one interpolated sentence rather than a bolded name spliced into a
	 * fixed English prefix (issue #120): word order around a name is not guaranteed to
	 * match between locales, so the whole sentence is the translated unit.
	 */
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import { messages, type Locale } from '$lib/i18n';

	let {
		user,
		locale
	}: { user: { id: string; name: string; email: string } | null; locale: Locale } = $props();

	const t = $derived(messages(locale).shell);

	let signingOut = $state(false);

	async function signOut() {
		signingOut = true;
		await authClient.signOut();
		await invalidateAll();
		signingOut = false;
		await goto(resolve('/'));
	}
</script>

<div class="flex items-center gap-3 border-b border-line bg-panel px-4 py-2 text-sm">
	{#if user}
		<span class="text-ink-2">{t.signedInAs(user.name)}</span>
		<button
			type="button"
			onclick={signOut}
			disabled={signingOut}
			class="ml-auto text-accent hover:underline disabled:opacity-60"
		>
			{signingOut ? t.signingOut : t.signOut}
		</button>
	{:else}
		<span class="text-ink-2">{t.notSignedIn}</span>
		<a href={resolve('/auth/sign-in')} class="ml-auto text-accent hover:underline">{t.signIn}</a>
		<a href={resolve('/auth/sign-up')} class="text-accent hover:underline">{t.signUp}</a>
	{/if}
</div>
