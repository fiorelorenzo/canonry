<script lang="ts">
	/**
	 * Issue #143 (I6 = B): the Account pane, the settings leaf that did not exist
	 * before this issue - name, email, password, sign out everywhere, delete account.
	 *
	 * Deletion (#154) is a server action, `?/requestDeletion` - only the server can tell
	 * "the confirmation mail failed to send" apart from "it sent"
	 * (`$lib/server/mail/delete-account.ts`'s own doc comment), the same reason
	 * `/auth/forgot-password` uses a form action rather than `authClient.forgetPassword`.
	 * `data.deletionImpact` (`+page.server.ts`'s `load`) is what makes the count real rather
	 * than a generic warning.
	 *
	 * Name and password are server actions too, since #262. They used to be `onsubmit`
	 * handlers calling `authClient.updateUser`/`authClient.changePassword`, which meant a
	 * submit before hydration was a GET to this URL; they leaked nothing only because those
	 * inputs carried no `name` attribute, and a nameless credential field is not a guard
	 * anybody reading this file would recognise as one. Better Auth's own message still
	 * reaches the reader for all three: it is request-time text from a library, not interface
	 * copy this app authors, so the action passes it through and only falls back to a
	 * catalogued string when there is none.
	 *
	 * Sign out everywhere stays on `authClient`: it is a button, not a form, so it submits
	 * no field and nothing of its own can reach a URL.
	 */
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { InlineLink } from '$lib/components/ui/link';
	import { messages } from '$lib/i18n';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const t = $derived(messages(data.locale).settings.account);

	let nameSaving = $state(false);
	let passwordSaving = $state(false);
	let handleSaving = $state(false);
	let handleRemoving = $state(false);

	// The handle after whichever action just ran, so the profile link appears the moment one
	// is taken and disappears the moment it is given up, without a second round trip. `form`
	// is null on a fresh load and on a failed submit, which is when `data.handle` is the
	// truth; `handleRemoved` has to be checked before `handleSaved`, because both are absent
	// from the other's result and only one of them can be present at a time.
	const currentHandle = $derived(
		form?.handleRemoved ? null : (form?.handleSaved ?? data.handle ?? null)
	);

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

	let deleteSending = $state(false);
</script>

<svelte:head>
	<title>{t.title}: Canonry</title>
</svelte:head>

{#if !data.user}
	<p class="mt-6 text-sm text-ink-2">
		<InlineLink href={resolve('/auth/sign-in')}>{t.signInLink}</InlineLink>
		{t.signInPrompt}
	</p>
{:else}
	<section class="mt-8 flex max-w-md flex-col gap-6">
		<form
			method="post"
			action="?/saveName"
			class="flex flex-col gap-3"
			use:enhance={() => {
				nameSaving = true;
				return async ({ update }) => {
					await update({ reset: false });
					nameSaving = false;
				};
			}}
		>
			<div class="flex flex-col gap-1.5">
				<Label for="account-name">{t.nameLabel}</Label>
				<Input
					id="account-name"
					name="name"
					autocomplete="name"
					required
					value={data.user.name ?? ''}
				/>
			</div>
			<div>
				<Button type="submit" disabled={nameSaving}>
					{nameSaving ? t.nameSaving : t.nameSave}
				</Button>
			</div>
			{#if form?.nameSaved}
				<p class="text-sm text-ink-2">{t.nameSaved}</p>
			{/if}
			{#if form?.nameError}
				<p role="alert" class="text-sm text-danger">{form.nameError}</p>
			{/if}
		</form>

		<div class="flex flex-col gap-1.5">
			<Label for="account-email">{t.emailLabel}</Label>
			<Input id="account-email" value={data.user.email} readonly disabled />
			<p class="text-xs text-muted">{t.emailNote}</p>
		</div>
	</section>

	<!-- Issue #158: the whole path to a profile existing. The handle is opt-in and chosen
	     here rather than at sign-up (recorded on that issue), so nothing anywhere else asks
	     for one, and an account that never comes to this section has no public page at all.
	     `profileDescription` is guardrail 5's short version beside the control that acts, in
	     the reader's own language, with `/privacy` carrying the same statement in full - F3 =
	     C's pattern, the same one the import and generate surfaces use. -->
	<section class="mt-10 max-w-md">
		<h2 class="text-title font-semibold text-ink">{t.profileHeading}</h2>
		<p class="mt-2 text-sm text-ink-2">{t.profileDescription}</p>
		<p class="mt-2 text-xs text-muted">
			{t.profilePrivacyPrompt}
			<InlineLink href={resolve('/privacy')}>{t.profilePrivacyLink}</InlineLink>
		</p>

		<form
			method="post"
			action="?/saveHandle"
			class="mt-4 flex flex-col gap-3"
			use:enhance={() => {
				handleSaving = true;
				return async ({ update }) => {
					await update({ reset: false });
					handleSaving = false;
				};
			}}
		>
			<div class="flex flex-col gap-1.5">
				<Label for="account-handle">{t.handleLabel}</Label>
				<!-- No `minlength` or `pattern` here on purpose: the rule lives in `@canonry/db`'s
				     `handles.ts`, next to the check constraint that enforces it, and a *value*
				     import from that barrel would pull drizzle and postgres.js into the client
				     bundle - the trap `@canonry/lang`'s own doc comment records from the afternoon
				     the relation catalogue spent in `packages/copilot`. The hint below states the
				     rule in words and the action answers with the exact reason, which is the same
				     division every other control in this pane already uses. -->
				<Input
					id="account-handle"
					name="handle"
					autocomplete="off"
					spellcheck="false"
					required
					value={data.handle ?? ''}
				/>
				<p class="text-xs text-muted">{t.handleHint}</p>
			</div>
			<div>
				<Button type="submit" disabled={handleSaving}>
					{handleSaving ? t.handleSaving : t.handleSave}
				</Button>
			</div>
			{#if form?.handleSaved}
				<p class="text-sm text-ink-2">{t.handleSaved}</p>
			{/if}
			{#if form?.handleRemoved}
				<p class="text-sm text-ink-2">{t.handleRemoved}</p>
			{/if}
			{#if form?.handleError}
				<p role="alert" class="text-sm text-danger">{form.handleError}</p>
			{/if}
		</form>

		{#if currentHandle}
			<div class="mt-4 flex flex-col gap-1.5">
				<p class="text-xs tracking-wide text-muted uppercase">{t.handleUrlLabel}</p>
				<p class="text-sm">
					<InlineLink href={`/u/${currentHandle}`}>/u/{currentHandle}</InlineLink>
				</p>
				<p class="text-xs text-muted">{t.handleChangeNote}</p>
			</div>
			<form
				method="post"
				action="?/removeHandle"
				class="mt-3"
				use:enhance={() => {
					handleRemoving = true;
					return async ({ update }) => {
						await update({ reset: false });
						handleRemoving = false;
					};
				}}
			>
				<Button type="submit" variant="secondary" disabled={handleRemoving}>
					{handleRemoving ? t.handleRemoving : t.handleRemove}
				</Button>
			</form>
		{:else}
			<p class="mt-4 text-sm text-muted">{t.profileNone}</p>
		{/if}
	</section>

	<section class="mt-10 max-w-md">
		<h2 class="text-title font-semibold text-ink">{t.passwordHeading}</h2>
		<form
			method="post"
			action="?/changePassword"
			class="mt-3 flex flex-col gap-3"
			use:enhance={() => {
				passwordSaving = true;
				return async ({ update }) => {
					await update();
					passwordSaving = false;
				};
			}}
		>
			<div class="flex flex-col gap-1.5">
				<Label for="current-password">{t.currentPasswordLabel}</Label>
				<Input
					id="current-password"
					type="password"
					name="currentPassword"
					autocomplete="current-password"
					required
				/>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="new-password">{t.newPasswordLabel}</Label>
				<Input
					id="new-password"
					type="password"
					name="newPassword"
					autocomplete="new-password"
					required
				/>
			</div>
			<div>
				<Button type="submit" disabled={passwordSaving}>
					{passwordSaving ? t.passwordSaving : t.passwordSave}
				</Button>
			</div>
			{#if form?.passwordSaved}
				<p class="text-sm text-ink-2">{t.passwordSaved}</p>
			{/if}
			{#if form?.passwordError}
				<p role="alert" class="text-sm text-danger">{form.passwordError}</p>
			{/if}
		</form>
	</section>

	<section class="mt-10 max-w-md">
		<h2 class="text-title font-semibold text-ink">{t.sessionsHeading}</h2>
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
		<h2 class="text-title font-semibold text-danger">{t.deleteHeading}</h2>
		<p class="mt-1 text-sm text-ink-2">{t.deleteIntro}</p>
		<p class="mt-2 text-sm text-ink-2">{t.deleteImpact(data.deletionImpact)}</p>
		<p class="mt-3 text-sm text-ink-2">
			{t.deleteExportPrompt}
			<InlineLink href={resolve('/settings/export')}>{t.deleteExportLink}</InlineLink>
		</p>

		{#if form?.deleteRequested}
			<p class="mt-4 text-sm text-ink-2">{t.deleteRequested}</p>
		{:else}
			<form
				method="POST"
				action="?/requestDeletion"
				class="mt-4 flex flex-col gap-3"
				use:enhance={() => {
					deleteSending = true;
					return async ({ update }) => {
						await update();
						deleteSending = false;
					};
				}}
			>
				<div class="flex flex-col gap-1.5">
					<Label for="delete-password">{t.deletePasswordLabel}</Label>
					<Input
						id="delete-password"
						type="password"
						name="password"
						autocomplete="current-password"
						required
					/>
				</div>
				<Button type="submit" variant="destructive" disabled={deleteSending} class="w-fit">
					{deleteSending ? t.deleteSending : t.deleteButton}
				</Button>
				{#if form?.deleteError}
					<p role="alert" class="text-sm text-danger">{form.deleteError}</p>
				{/if}
			</form>
		{/if}
	</section>
{/if}
