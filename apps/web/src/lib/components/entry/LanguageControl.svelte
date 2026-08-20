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
	 * Issue #286, decision O4 = B: this is a state rather than a list, so it is the
	 * segmented control. Guardrail 1 is the reason the shape matters here and not only
	 * the paint: the four choices have to stay four visibly separate answers, because
	 * "the machine is guessing" and "a person decided" are exactly what this field
	 * records, and a control that collapses them behind one trigger hides the bit the
	 * guardrail exists to protect.
	 *
	 * **Without JavaScript this form keeps working, and it did not before.** The radios
	 * are native, so the value posts on its own; what needed JavaScript was the submit,
	 * since `onchange` below is the only trigger there has ever been. The `<noscript>`
	 * button supplies the other one, so a reader with scripting off can change the
	 * language rather than looking at a control that does nothing.
	 */
	import { enhance } from '$app/forms';
	import { Segmented, type SegmentedOption } from '$lib/components/ui/segmented';
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

	const options = $derived<SegmentedOption[]>([
		{ value: 'auto', label: t.entry.language.autoDetect },
		...LOCALES.map((entityLocale) => ({
			value: entityLocale,
			label: LOCALE_NAMES[entityLocale]
		})),
		{ value: 'unsure', label: t.entry.language.unsure }
	]);
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
		<span id="entry-language-label" class="font-mono text-[10px] tracking-wide text-muted uppercase"
			>{t.entry.language.label}</span
		>
		<Segmented
			name="language"
			bind:value={choice}
			{options}
			disabled={!canWrite || submitting}
			labelledby="entry-language-label"
			onchange={() => formEl?.requestSubmit()}
			class="text-xs"
		/>
		<!-- The one submit trigger that is not `onchange` above. Parsed as inert text
		     whenever scripting is on, so the enhanced path never shows a button the GM
		     would have to press. -->
		<noscript>
			<Button type="submit" variant="secondary" size="sm" disabled={!canWrite}>
				{t.controls.apply}
			</Button>
		</noscript>
	</div>
	{#if source === 'detected'}
		<p class="mt-1 text-[11px] text-muted">
			{t.entry.language.detectedPrefix(
				detected ? LOCALE_NAMES[detected] : t.entry.language.detectedUnknown
			)}
		</p>
	{/if}
</form>
