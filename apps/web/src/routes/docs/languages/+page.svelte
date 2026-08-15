<script lang="ts">
	/** Issue #131: the doc a GM reads before trusting Canonry with a world already written
	 * in one or more languages. SPEC.md §17 states three rules (interface+copilot follow
	 * you, canon keeps its own per-entry language, retrieval crosses the gap) and this page
	 * says the same three in plain voice, plus the limits that are the point of the page -
	 * no bulk translation (guardrail 1: nothing a model produces lands in canon without a
	 * human accepting it, one entry at a time, and a mass rewrite is exactly the unaccepted
	 * writing that guardrail exists to stop), quotations verbatim (guardrail 3: a translated
	 * quotation is not the sentence it claims to quote), and the one place the two "follows
	 * your language" rules point in opposite directions on purpose (the copilot addressing
	 * you vs. the copilot writing into an entry).
	 *
	 * Locale-aware like the rest of #120's surfaces (`data.locale`, no own load needed - this
	 * route has no `+page.server.ts`, so `PageData` is exactly the root layout's data), unlike
	 * its sibling docs pages (`/docs`, `/docs/import`, `/privacy`), which predate the
	 * catalogue and are issue #121's sweep, not this one's. */
	import DocPage from '$lib/components/docs/DocPage.svelte';
	import { messages } from '$lib/i18n';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const t = $derived(messages(data.locale).docsLanguages);
</script>

<svelte:head>
	<title>{t.title}: Canonry</title>
</svelte:head>

<DocPage title={t.title} eyebrow="Docs">
	<p>{t.intro}</p>

	<h2>{t.interfaceHeading}</h2>
	<p>{t.interfaceBody}</p>

	<h2>{t.canonHeading}</h2>
	<p>{t.canonBody}</p>
	<p>{t.namesBody}</p>

	<h2>{t.retrievalHeading}</h2>
	<p>{t.retrievalBody}</p>

	<h2>{t.noRewriteHeading}</h2>
	<p>{t.noRewriteBody}</p>

	<h2>{t.limitsHeading}</h2>
	<p>{t.limitsIntro}</p>
	<ul>
		<li>{t.limitLocales}</li>
		<li>{t.limitNoBulkTranslation}</li>
		<li>{t.limitQuotations}</li>
		<li>{t.limitCopilotDirection}</li>
	</ul>
</DocPage>
