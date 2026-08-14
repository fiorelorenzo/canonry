<script lang="ts">
	/**
	 * A direct link target as well as what the shell's sign-out control points at:
	 * signs the session out the moment this page mounts, then leaves. `onMount` runs
	 * exactly once client-side, which is the only place `authClient.signOut()` can run.
	 */
	import { onMount } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';

	onMount(async () => {
		await authClient.signOut();
		await invalidateAll();
		await goto(resolve('/'));
	});
</script>

<svelte:head>
	<title>Signing out: Canonry</title>
</svelte:head>

<main id="main" class="mx-auto max-w-measure px-8 py-16">
	<p class="text-sm text-ink-2">Signing out…</p>
</main>
