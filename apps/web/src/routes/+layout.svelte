<script lang="ts">
	import './layout.css';
	import AppShell from '$lib/components/shell/AppShell.svelte';
	import { messages } from '$lib/i18n';
	import { applyThemePreferenceToDocument } from '$lib/theme';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: Snippet; data: LayoutData } = $props();

	const t = $derived(messages(data.locale));

	// Keeps `<html lang>` correct after a client-side locale change (the settings
	// language page and the auth pages' compact switcher both submit through
	// `use:enhance`, so `data.locale` updates without a full document reload -
	// hooks.server.ts's transformPageChunk only rewrites the attribute on a fresh SSR
	// response, and nothing else in SvelteKit ever touches `document.documentElement`).
	$effect(() => {
		document.documentElement.lang = data.locale;
	});

	// The same thing for the theme (#752), and for the same reason: `app.html` carries
	// `<html data-theme>` and the two `theme-color` metas, hooks.server.ts writes them per
	// request, and the appearance page submits through `use:enhance`, so before this a GM
	// picked Dark and watched nothing happen - measured on a light OS, `data-theme` stayed
	// null and `--color-paper` stayed `#f4efe4` for the rest of the session, through every
	// client-side navigation, until a full document load. Here rather than in that form's
	// own callback so any future path that changes the preference repaints too, exactly as
	// the locale effect above already covers both of its two submitters.
	$effect(() => {
		applyThemePreferenceToDocument(document, data.themePreference);
	});

	// The spec's own TL;DR sentence (SPEC.md §1), not marketing copy: guardrail 7 means
	// this product never certifies a canon is coherent, so the description it ships in
	// link previews has to be the same careful sentence the app itself is held to.
	// Issue #138 reuses this exact string as the door page's own visible sentence
	// rather than a second copy hardcoded there - one sentence, one catalogue entry,
	// in both languages, instead of a meta tag and a page quietly drifting apart.
	const DESCRIPTION = $derived(t.shell.tagline);
	// Absolute, not `/og.png`: a relative OG image is the one thing every crawler that
	// matters (Slack, Discord, iMessage) silently refuses to resolve.
	const ogImage = $derived(`${data.origin}/og.png`);
</script>

<svelte:head>
	<meta name="description" content={DESCRIPTION} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Canonry" />
	<meta property="og:title" content="Canonry" />
	<meta property="og:description" content={DESCRIPTION} />
	<meta property="og:image" content={ogImage} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="Canonry" />
	<meta name="twitter:description" content={DESCRIPTION} />
	<meta name="twitter:image" content={ogImage} />
</svelte:head>

<a
	href="#main"
	class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-body focus:font-medium focus:text-panel"
>
	{t.shell.skipToContent}
</a>
<AppShell>
	{@render children()}
</AppShell>
