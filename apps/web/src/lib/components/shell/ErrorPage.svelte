<script lang="ts">
	/**
	 * Issue #471: the body every `+error.svelte` in the app renders, self-contained
	 * rather than prop-driven - it reads `page` from `$app/state` itself, exactly like
	 * `AppShell.svelte` reads `page.data` itself, so a route file that mounts it needs
	 * no wiring beyond importing it.
	 *
	 * Two boundaries mount this, on purpose, and the difference between them is the
	 * whole reason there are two:
	 *
	 * - `routes/+error.svelte` (root): catches an unmatched route (`/nope`), a
	 *   failure in the root layout itself, and - this is the one that is easy to get
	 *   wrong - a failure in `w/[universe]/+layout.server.ts` (an unowned or
	 *   nonexistent universe slug). SvelteKit never lets a directory's own
	 *   `+error.svelte` catch its *sibling* layout's load error (only a boundary
	 *   *above* that layout qualifies - `svelte.dev/docs/kit/routing#error`), so a
	 *   universe that fails to resolve at all correctly bubbles past
	 *   `w/[universe]/+error.svelte` and lands here, with no universe on `page.data`
	 *   to offer back. That is `universeSlug` below reading `null` honestly, not a bug.
	 * - `routes/w/[universe]/+error.svelte`: catches anything thrown *underneath* an
	 *   already-resolved universe - `e/[slug]/+page.server.ts`'s entry-not-found is
	 *   the issue's own repro. Verified against a real render (not assumed): a root-
	 *   only `+error.svelte` does *not* carry `w/[universe]/+layout.server.ts`'s
	 *   `current`/`universeSlug` onto `page.data` even though that load succeeded -
	 *   SvelteKit only merges ancestor layouts from the root down to the directory
	 *   the *matched* `+error.svelte` lives in, and a root-level match sits above
	 *   `w/[universe]/+layout.server.ts`, not below it. The scoped file at that
	 *   directory is what makes the ancestor chain include it, and is the only way
	 *   this page can `AppShell.svelte`-mode-switch into keeping the sidebar, the
	 *   switcher and the universe nav exactly as they were for any other page in that
	 *   world. Nothing here re-queries a universe by parsing the URL by hand - that
	 *   would be inventing a second, untrusted source of the same access check
	 *   `w/[universe]/+layout.server.ts` already ran once.
	 *
	 * Status is honest, not diagnostic: everything that isn't 404 reads as the
	 * "something went wrong" copy, and that copy never echoes `page.error.message`.
	 * The default `handleError` (`app.d.ts`'s `App.Error` is still the SvelteKit
	 * default `{ message: string }`) hands back whatever it decided was safe to
	 * expose for an *unexpected* exception - not necessarily translated, not
	 * necessarily this reader's language, and not this page's job to parrot. The
	 * catalogue (`errorPage`, `$lib/i18n`) is the only copy this page ever shows.
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { DEFAULT_LOCALE, messages, type Locale } from '$lib/i18n';
	import { PageHeader, PageBody } from '$lib/components/ui/page-header';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { Button } from '$lib/components/ui/button';
	import { paletteState } from '$lib/components/palette/palette-state.svelte';

	/** The fields this page reads off the merged `page.data` - the same narrowing
	 * `AppShell.svelte`'s own `ShellPageData` does, and for the same reason: every
	 * field here is only present on some boundaries, which is the whole point above,
	 * not something a single global interface should paper over. */
	interface ErrorPageData {
		locale?: Locale;
		user?: { id: string; name: string; email: string } | null;
		universeSlug?: string;
	}

	const data = $derived((page.data ?? {}) as ErrorPageData);
	const locale = $derived(data.locale ?? DEFAULT_LOCALE);
	const t = $derived(messages(locale).errorPage);
	const isNotFound = $derived(page.status === 404);
	const isSignedIn = $derived(Boolean(data.user));
	const universeSlug = $derived(data.universeSlug ?? null);
	// A full reload, not a client-side `goto` to the same URL: the point of "try
	// again" on an unexpected error is to re-run the load that just threw from a
	// clean request, and only a real navigation guarantees that.
	const retryHref = $derived(page.url.pathname + page.url.search);
</script>

<svelte:head>
	<title>{isNotFound ? t.notFoundHeading : t.serverErrorHeading}: Canonry</title>
</svelte:head>

<PageHeader
	eyebrow={String(page.status)}
	title={isNotFound ? t.notFoundHeading : t.serverErrorHeading}
/>

<PageBody width="reading">
	<div class="mt-6">
		{#if isNotFound}
			<EmptyState kind="derived" message={t.notFoundBody}>
				{#snippet action()}
					<div class="flex flex-wrap justify-center gap-2">
						{#if universeSlug}
							<Button href={resolve(`/w/${universeSlug}`)} variant="secondary" size="sm">
								{t.worldHomeAction}
							</Button>
							<Button href={resolve(`/w/${universeSlug}/entries`)} variant="secondary" size="sm">
								{t.entriesAction}
							</Button>
						{:else if isSignedIn}
							<Button href={resolve('/')} variant="secondary" size="sm">
								{t.allUniversesAction}
							</Button>
						{/if}
						{#if isSignedIn}
							<Button
								type="button"
								variant="secondary"
								size="sm"
								onclick={() => (paletteState.open = true)}
							>
								{t.searchAction}
							</Button>
						{/if}
					</div>
				{/snippet}
			</EmptyState>
		{:else}
			<EmptyState kind="derived" message={t.serverErrorBody}>
				{#snippet action()}
					<div class="flex flex-wrap justify-center gap-2">
						<Button href={retryHref} data-sveltekit-reload variant="secondary" size="sm">
							{t.retryAction}
						</Button>
						{#if universeSlug}
							<Button href={resolve(`/w/${universeSlug}`)} variant="secondary" size="sm">
								{t.worldHomeAction}
							</Button>
						{:else if isSignedIn}
							<Button href={resolve('/')} variant="secondary" size="sm">
								{t.allUniversesAction}
							</Button>
						{/if}
					</div>
				{/snippet}
			</EmptyState>
		{/if}
	</div>
</PageBody>
