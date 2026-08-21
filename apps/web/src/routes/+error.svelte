<script lang="ts">
	/**
	 * Issue #471: the root error boundary - catches an unmatched route, a root
	 * layout failure, and a `w/[universe]/+layout.server.ts` failure (SvelteKit never
	 * lets a directory's own `+error.svelte` catch its sibling layout's load error,
	 * only a boundary above it - see `ErrorPage.svelte`'s own doc comment). None of
	 * those has a resolvable universe to offer back, and `ErrorPage.svelte` reads
	 * that honestly off `page.data` itself rather than being told.
	 */
	import ErrorPage from '$lib/components/shell/ErrorPage.svelte';
</script>

<ErrorPage />
