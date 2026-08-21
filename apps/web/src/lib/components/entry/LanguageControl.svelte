<script lang="ts">
	/**
	 * SPEC.md §17, issue #122: the entry's own language, a per-entry claim about the prose
	 * itself. Four answers, not three: "Auto-detect" reverts to the free heuristic (and
	 * re-runs it immediately), "Not sure / mixed" is the GM's own explicit null, and the two
	 * locales are a hand-set claim. Only the last three ever write `languageSource: 'human'`
	 * - "Auto-detect" is the one choice that puts the entry back under detection instead of
	 * confirming a value.
	 *
	 * **It lives on the editor, not on the entry's reading surface (#347).** It was under
	 * every entry's title until round eleven, which is a defect against I5: the language
	 * switch in the reading chrome is the interface's own, in the account menu, and this is a
	 * different field with a different scope. What this one governs is read by cross-lingual
	 * retrieval and by every proposal drafted into the entry, and the GM only reaches for it
	 * when detection got a mixed or too-short entry wrong, which is a correction to the text
	 * rather than something to read. Its action moved with it: `?/setLanguage` is the
	 * editor's route now.
	 *
	 * The caption below the control is deliberately only shown while nothing has been
	 * confirmed (`languageSource === 'detected'`): it is the machine's guess, worth
	 * showing so the GM can see it without it becoming a claim, and it disappears the
	 * moment there is an actual claim to show in the control itself instead. A null guess
	 * ("not enough text to tell") reads the same as any other guess - unknown is not a
	 * defect, so there is nothing here shaped like a warning.
	 *
	 * Issue #383, decision R8 (docs/ux/DECISIONS.md, "Round thirteen"): this was the
	 * segmented control issue #286/O4 = B put here, and R8 moves it to the Select. The
	 * reasoning that used to justify the segmented control - "the machine is guessing"
	 * versus "a person decided" are different enough that they should stay four visibly
	 * separate answers - is exactly what R8 weighs against a shipped vocabulary that
	 * grows by one every time a locale is added, and decides the other way: this is a
	 * vocabulary control, not a state, O4's own boundary, and it was misclassified. The
	 * vocabulary itself is unchanged - still four members, still the same four meanings -
	 * only the control they are offered through is different.
	 *
	 * **Without JavaScript this form keeps working, and it did not before #383.** A
	 * popover cannot open without scripting, so `ui/native-fallback` renders a real
	 * `<select>` inside `<noscript>` and the trigger is marked `data-js-only`, the same
	 * split `works/[work]/+page.svelte` uses; `Select.Root` carries no `name` of its own,
	 * so the fallback is the only value carrier in either mode. `onValueChange` calls
	 * `flushSync` before `requestSubmit()` for the same reason `ProposalQueue.svelte`
	 * does: `bind:value` updates `choice` immediately, but `NativeFallback`'s hidden
	 * input only reflects it once Svelte's own effect queue runs, which `requestSubmit()`
	 * does not wait for on its own - without the flush the request carries the value
	 * from before the click. The `<noscript>` button supplies the submit that scripting
	 * would otherwise give it via `onValueChange`.
	 */
	import { enhance } from '$app/forms';
	import { flushSync } from 'svelte';
	import * as Select from '$lib/components/ui/select';
	import { NativeFallback } from '$lib/components/ui/native-fallback';
	import { Button } from '$lib/components/ui/button';
	import { LOCALES, LOCALE_NAMES, messages, type Locale } from '$lib/i18n';
	import type { LanguageSource } from '@canonry/db/schema';

	let {
		language,
		languageSource,
		canWrite,
		locale
	}: {
		language: Locale | null;
		languageSource: LanguageSource;
		canWrite: boolean;
		locale: Locale;
	} = $props();
	let t = $derived(messages(locale));

	// The control's value space is wider than `Locale | null`: 'auto' and 'unsure' are both
	// real choices with no locale of their own, so they need their own tokens rather than
	// overloading null for two different meanings the way the stored column does (which is
	// exactly why `languageSource` exists at the database layer too).
	function choiceFor(language: Locale | null, languageSource: LanguageSource): string {
		if (languageSource === 'detected') return 'auto';
		return language ?? 'unsure';
	}

	// `language`/`languageSource` seed local state once; `use:enhance`'s callback below is
	// what keeps it in sync after that, the same pattern `edit/+page.svelte`'s own `body`
	// state uses for the same reason (this component outlives a single server round trip).
	// svelte-ignore state_referenced_locally
	let choice = $state(choiceFor(language, languageSource));
	// svelte-ignore state_referenced_locally
	let detected = $state(language);
	// svelte-ignore state_referenced_locally
	let source = $state(languageSource);
	let submitting = $state(false);

	let formEl: HTMLFormElement | undefined;
	const uid = $props.id();
	const labelId = `entry-language-label-${uid}`;

	const options = $derived([
		{ value: 'auto', label: t.entry.language.autoDetect },
		...LOCALES.map((entityLocale) => ({
			value: entityLocale as string,
			label: LOCALE_NAMES[entityLocale]
		})),
		{ value: 'unsure', label: t.entry.language.unsure }
	] satisfies { value: string; label: string }[]);
	const choiceLabel = $derived(options.find((option) => option.value === choice)?.label ?? choice);
</script>

<form
	bind:this={formEl}
	method="POST"
	action="?/setLanguage"
	class="flex-none"
	use:enhance={() => {
		submitting = true;
		return async ({ result }) => {
			submitting = false;
			if (result.type === 'success' && result.data) {
				const data = result.data as { language: Locale | null; languageSource: LanguageSource };
				detected = data.language;
				source = data.languageSource;
				choice = choiceFor(data.language, data.languageSource);
			}
		};
	}}
>
	<div class="flex flex-wrap items-center gap-1.5 text-xs text-ink-2">
		<span id={labelId} class="font-mono text-label tracking-wide text-muted uppercase"
			>{t.entry.language.label}</span
		>
		<div data-js-only>
			<Select.Root
				type="single"
				bind:value={choice}
				onValueChange={() => {
					flushSync();
					formEl?.requestSubmit();
				}}
			>
				<Select.Trigger
					size="sm"
					aria-labelledby={labelId}
					disabled={!canWrite || submitting}
					class="text-xs"
				>
					{choiceLabel}
				</Select.Trigger>
				<Select.Content>
					{#each options as option (option.value)}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		<NativeFallback
			name="language"
			value={choice}
			{options}
			disabled={!canWrite}
			label={t.entry.language.label}
		/>
		<!-- The one submit trigger that is not `onValueChange` above. Parsed as inert text
		     whenever scripting is on, so the enhanced path never shows a button the GM
		     would have to press. -->
		<noscript>
			<Button type="submit" variant="secondary" size="sm" disabled={!canWrite}>
				{t.controls.apply}
			</Button>
		</noscript>
	</div>
	{#if source === 'detected'}
		<p class="mt-1 text-label text-muted">
			{t.entry.language.detectedPrefix(
				detected ? LOCALE_NAMES[detected] : t.entry.language.detectedUnknown
			)}
		</p>
	{/if}
</form>
