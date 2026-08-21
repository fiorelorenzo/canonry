<script lang="ts">
	/**
	 * #192, decision K1 (DECISIONS.md "Round six"): the relation catalogue a GM can
	 * actually see. Issue #450 (U1, DECISIONS.md "Round sixteen"): this leaf moves
	 * inside the two-pane settings shell (#421) as the Canon group's own page - the
	 * standalone `max-w-4xl` container and its own back link are gone, replaced by
	 * `SettingsShell` plus the same `UniverseSettingsRail` the settings page itself
	 * renders (`active="canon"` marks the row this leaf belongs to). A page reached
	 * from Settings that does not look like Settings is a page you have to find twice.
	 *
	 * `PageHeader`'s `eyebrow` reads the settings heading rather than the universe name
	 * this leaf used to carry: the universe is already named in the rail's own
	 * surroundings (the shell sits under the universe's own nav), and "Impostazioni" is
	 * what tells a GM which page they landed on twice removed from a search result or a
	 * bookmark.
	 */
	import { resolve } from '$app/paths';
	import { messages } from '$lib/i18n';
	import { PageHeader } from '$lib/components/ui/page-header';
	import SettingsShell from '$lib/components/settings/SettingsShell.svelte';
	import UniverseSettingsRail from '$lib/components/settings/UniverseSettingsRail.svelte';
	import RelationCatalogue from '$lib/components/relations/RelationCatalogue.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const settingsT = $derived(messages(data.locale).universe.settings);
	const t = $derived(settingsT.relations);
	const relationTypeLabel = $derived(messages(data.locale).relationTypeLabel);

	// Same three rows the settings page's own rail carries, pointed back at that page's
	// fragment anchors rather than this page's own url - `SettingsShell`'s rail is
	// same-page anchors by design (see `UniverseSettingsRail`'s doc comment), and this
	// leaf sits one level below the page those anchors scroll.
	const settingsHref = $derived(resolve(`/w/${data.universeSlug}/settings`));
	const railItems = $derived([
		{
			id: 'images' as const,
			href: `${settingsHref}#group-images`,
			label: settingsT.groups.images,
			unset: data.setupItems.some((item) => item.id === 'imageStyle' && !item.done)
		},
		{
			id: 'loremaster' as const,
			href: `${settingsHref}#group-loremaster`,
			label: settingsT.groups.loremaster,
			unset: data.setupItems.some((item) => item.id === 'loremasterVoice' && !item.done)
		},
		{
			id: 'canon' as const,
			href: `${settingsHref}#group-canon`,
			label: settingsT.groups.canon,
			unset: false
		}
	]);
</script>

<svelte:head><title>{t.headTitle(data.universeName)}</title></svelte:head>

<SettingsShell>
	{#snippet rail()}
		<UniverseSettingsRail
			ariaLabel={settingsT.rail.ariaLabel}
			incompleteMark={settingsT.rail.incompleteMark}
			items={railItems}
			active="canon"
		/>
	{/snippet}

	<PageHeader
		eyebrow={settingsT.heading}
		title={t.title}
		description={t.description(data.universeName)}
	/>

	<div class="mt-8">
		<RelationCatalogue
			types={data.types}
			{t}
			{relationTypeLabel}
			locale={data.locale}
			canManage={data.canManage}
			form={form ?? undefined}
		/>
	</div>
</SettingsShell>
