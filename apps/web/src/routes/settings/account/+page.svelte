<script lang="ts">
	/**
	 * Issue #143 (I6 = B): the Account pane, the settings leaf that did not exist
	 * before this issue - name, email, password, sign out everywhere, delete account.
	 * Name and password go through Better Auth's own client API rather than a form
	 * action (`authClient.updateUser`/`authClient.changePassword`), the same pattern
	 * the sign-in page already uses for `authClient.signIn.email` - both return
	 * `{ error }` with Better Auth's own message, which is not catalogued (it is
	 * request-time text from a library, not interface copy this app authors).
	 *
	 * No delete-account control: Better Auth's `/delete-user` 404s until
	 * `user.deleteUser.enabled` is set in `lib/server/auth.ts` (checked against the
	 * installed better-auth 1.6.27 source), which this deployment does not set. A
	 * button that always fails is worse than no button, so this pane says why instead.
	 */
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { PageHeader } from '$lib/components/ui/page-header';
	import { messages } from '$lib/i18n';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const t = $derived(messages(data.locale).settings.account);

	// Seeds the field once; the form owns it after that. The reason sits on its own line
	// because `svelte-ignore` reads everything after the rule name as further rule names,
	// which is what made eslint report ten phantom unused ignores here.
	// svelte-ignore state_referenced_locally
	let name = $state(data.user?.name ?? '');
	let nameSaving = $state(false);
	let nameSaved = $state(false);
	let nameError = $state<string | null>(null);

	async function saveName(event: SubmitEvent) {
		event.preventDefault();
		nameError = null;
		nameSaved = false;
		if (name.trim().length === 0) return;
		nameSaving = true;
		const { error } = await authClient.updateUser({ name: name.trim() });
		nameSaving = false;
		if (error) {
			nameError = error.message ?? t.nameSaveFailedFallback;
			return;
		}
		nameSaved = true;
		await invalidateAll();
	}

	let currentPassword = $state('');
	let newPassword = $state('');
	let passwordSaving = $state(false);
	let passwordSaved = $state(false);
	let passwordError = $state<string | null>(null);

	async function changePassword(event: SubmitEvent) {
		event.preventDefault();
		passwordError = null;
		passwordSaved = false;
		passwordSaving = true;
		const { error } = await authClient.changePassword({ currentPassword, newPassword });
		passwordSaving = false;
		if (error) {
			passwordError = error.message ?? t.passwordSaveFailedFallback;
			return;
		}
		currentPassword = '';
		newPassword = '';
		passwordSaved = true;
	}

	let signingOutEverywhere = $state(false);
	let signOutEverywhereError = $state<string | null>(null);

	async function signOutEverywhere() {
		signOutEverywhereError = null;
		signingOutEverywhere = true;
		// #143: revokeSessions deletes every session row for this account, current one
		// included, but does not itself clear this browser's cookie - the follow-up
		// signOut() is what makes "everywhere" include this device too, immediately,
		// rather than leaving it holding a cookie for a session Better Auth already
		// deleted server-side.
		const { error } = await authClient.revokeSessions();
		if (error) {
			signOutEverywhereError = error.message ?? t.signOutEverywhereFailedFallback;
			signingOutEverywhere = false;
			return;
		}
		await authClient.signOut();
		await invalidateAll();
		await goto(resolve('/'));
	}
</script>

<svelte:head>
	<title>{t.title}: Canonry</title>
</svelte:head>

<PageHeader title={t.title} description={t.description} />

{#if !data.user}
	<p class="mt-6 text-sm text-ink-2">
		<a href={resolve('/auth/sign-in')} class="text-accent hover:underline">{t.signInLink}</a>
		{t.signInPrompt}
	</p>
{:else}
	<section class="mt-8 flex max-w-md flex-col gap-6">
		<form onsubmit={saveName} class="flex flex-col gap-3">
			<div class="flex flex-col gap-1.5">
				<Label for="account-name">{t.nameLabel}</Label>
				<Input id="account-name" name="name" autocomplete="name" required bind:value={name} />
			</div>
			<div>
				<Button type="submit" disabled={nameSaving || name.trim().length === 0}>
					{nameSaving ? t.nameSaving : t.nameSave}
				</Button>
			</div>
			{#if nameSaved && !nameError}
				<p class="text-sm text-ink-2">{t.nameSaved}</p>
			{/if}
			{#if nameError}
				<p role="alert" class="text-sm text-danger">{nameError}</p>
			{/if}
		</form>

		<div class="flex flex-col gap-1.5">
			<Label for="account-email">{t.emailLabel}</Label>
			<Input id="account-email" value={data.user.email} readonly disabled />
			<p class="text-xs text-muted">{t.emailNote}</p>
		</div>
	</section>

	<section class="mt-10 max-w-md">
		<h2 class="text-sm font-semibold text-ink">{t.passwordHeading}</h2>
		<form onsubmit={changePassword} class="mt-3 flex flex-col gap-3">
			<div class="flex flex-col gap-1.5">
				<Label for="current-password">{t.currentPasswordLabel}</Label>
				<Input
					id="current-password"
					type="password"
					autocomplete="current-password"
					required
					bind:value={currentPassword}
				/>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="new-password">{t.newPasswordLabel}</Label>
				<Input
					id="new-password"
					type="password"
					autocomplete="new-password"
					required
					bind:value={newPassword}
				/>
			</div>
			<div>
				<Button type="submit" disabled={passwordSaving}>
					{passwordSaving ? t.passwordSaving : t.passwordSave}
				</Button>
			</div>
			{#if passwordSaved && !passwordError}
				<p class="text-sm text-ink-2">{t.passwordSaved}</p>
			{/if}
			{#if passwordError}
				<p role="alert" class="text-sm text-danger">{passwordError}</p>
			{/if}
		</form>
	</section>

	<section class="mt-10 max-w-md">
		<h2 class="text-sm font-semibold text-ink">{t.sessionsHeading}</h2>
		<p class="mt-1 text-sm text-ink-2">{t.sessionsDescription}</p>
		<div class="mt-3">
			<Button variant="secondary" onclick={signOutEverywhere} disabled={signingOutEverywhere}>
				{signingOutEverywhere ? t.signOutEverywhereInProgress : t.signOutEverywhereButton}
			</Button>
		</div>
		{#if signOutEverywhereError}
			<p role="alert" class="mt-2 text-sm text-danger">{signOutEverywhereError}</p>
		{/if}
	</section>

	<section class="mt-10 max-w-md">
		<h2 class="text-sm font-semibold text-danger">{t.deleteHeading}</h2>
		<p class="mt-1 text-sm text-ink-2">{t.deleteUnavailable}</p>
	</section>
{/if}
