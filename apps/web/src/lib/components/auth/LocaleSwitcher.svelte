<script lang="ts">
	/**
	 * The compact switcher SPEC.md §17 asks for on the sign-in and sign-up pages: there
	 * is no account yet to hold a preference, so it sets the `canonry_locale` cookie
	 * instead (`negotiateLocale`'s second rung, ahead of `Accept-Language`, behind an
	 * account preference once one exists). Both pages render this identically and post
	 * to their own `?/setLocale` action - see either page's `+page.server.ts`.
	 *
	 * Issue #383, decision R8 (docs/design/DECISIONS.md, "Round thirteen"): this used to be
	 * a row of native buttons, one per locale, which is neither of O4 = B's three shapes
	 * and stops fitting the moment there is a third language. The interface locale is a
	 * vocabulary the product itself ships, so it becomes the Select.
	 *
	 * **Without JavaScript this form keeps working, same as before.** The Select is a
	 * popover, which cannot open without scripting, so `ui/native-fallback` renders a
	 * real `<select>` inside `<noscript>` and the trigger is marked `data-js-only` so
	 * only one of the two is ever the value carrier - `Select.Root` deliberately carries
	 * no `name` of its own, the same split `works/[work]/+page.svelte` uses. The old row
	 * of native buttons submitted itself on click; a lone `<select>` does not submit on
	 * Enter in every browser, so its own `<noscript>` button supplies the explicit
	 * submit, the same pairing `LanguageControl.svelte` uses.
	 * `onValueChange` calls `flushSync` before `requestSubmit()`, the same fix
	 * `ProposalQueue.svelte` already needed: `bind:value` updates `value` immediately,
	 * but the fallback's hidden input only catches up once Svelte's effect queue runs,
	 * which a synchronous `requestSubmit()` does not wait for on its own.
	 *
	 * Locale names are shown as endonyms (`LOCALE_NAMES`, "English"/"Italiano"), each in
	 * its own language, not translated through the active locale - the one label a
	 * language switcher must never need translating to be understood.
	 */
	import { enhance } from '$app/forms';
	import { flushSync } from 'svelte';
	import * as Select from '$lib/components/ui/select';
	import { NativeFallback } from '$lib/components/ui/native-fallback';
	import { Button } from '$lib/components/ui/button';
	import { LOCALE_NAMES, LOCALES, messages, type Locale } from '$lib/i18n';

	let { locale }: { locale: Locale } = $props();

	const label = $derived(messages(locale).auth.languageSwitcher.label);
	const options = $derived(LOCALES.map((loc) => ({ value: loc, label: LOCALE_NAMES[loc] })));

	// svelte-ignore state_referenced_locally
	let value = $state<string>(locale);
	const valueLabel = $derived(options.find((option) => option.value === value)?.label ?? value);

	let formEl: HTMLFormElement | undefined;
	const uid = $props.id();
	const labelId = `locale-switcher-label-${uid}`;
</script>

<form
	bind:this={formEl}
	method="POST"
	action="?/setLocale"
	use:enhance={() => {
		return async ({ result, update }) => {
			// A rejected submission (fail(400), an option the UI never actually offers)
			// reverts the trigger to the locale still in effect rather than stranding it
			// on a choice the server refused.
			if (result.type !== 'success') value = locale;
			await update();
		};
	}}
	class="flex items-center gap-2 text-label"
>
	<span id={labelId} class="sr-only">{label}</span>
	<div data-js-only>
		<Select.Root
			type="single"
			bind:value
			onValueChange={() => {
				flushSync();
				formEl?.requestSubmit();
			}}
		>
			<Select.Trigger size="sm" aria-labelledby={labelId} class="text-label font-medium uppercase">
				{valueLabel}
			</Select.Trigger>
			<Select.Content>
				{#each options as option (option.value)}
					<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>
	<NativeFallback name="locale" {value} {options} {label} />
	<noscript>
		<Button type="submit" variant="secondary" size="sm">{messages(locale).controls.apply}</Button>
	</noscript>
</form>
