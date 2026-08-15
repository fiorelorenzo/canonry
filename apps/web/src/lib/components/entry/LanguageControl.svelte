<script lang="ts">
	/**
	 * SPEC.md §17, issue #122: the entry's own language, next to its type rather than
	 * buried in a settings panel. Four answers, not three: "Auto-detect" reverts to the
	 * free heuristic (and re-runs it immediately), "Not sure / mixed" is the GM's own
	 * explicit null, and the two locales are a hand-set claim. Only the last three ever
	 * write `languageSource: 'human'` - "Auto-detect" is the one choice that puts the
	 * entry back under detection instead of confirming a value.
	 *
	 * The caption below the select is deliberately only shown while nothing has been
	 * confirmed (`languageSource === 'detected'`): it is the machine's guess, worth
	 * showing so the GM can see it without it becoming a claim, and it disappears the
	 * moment there is an actual claim to show in the select itself instead. A null guess
	 * ("not enough text to tell") reads the same as any other guess - unknown is not a
	 * defect, so there is nothing here shaped like a warning.
	 */
	import { enhance } from '$app/forms';
	import { LOCALES, LOCALE_NAMES, type Locale } from '@canonry/lang';
	import type { LanguageSource } from '@canonry/db/schema';

	let {
		language,
		languageSource,
		canWrite
	}: { language: Locale | null; languageSource: LanguageSource; canWrite: boolean } = $props();

	// The select's value space is wider than `Locale | null`: 'auto' and 'unsure' are both
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
</script>

<form
	bind:this={formEl}
	method="POST"
	action="?/setLanguage"
	class="flex-none text-right"
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
	<label class="flex items-center justify-end gap-1.5 text-xs text-ink-2">
		<span class="font-mono text-[10px] tracking-wide text-muted uppercase">Language</span>
		<select
			name="language"
			bind:value={choice}
			disabled={!canWrite || submitting}
			onchange={() => formEl?.requestSubmit()}
			class="rounded-md border border-line-2 bg-panel px-1.5 py-0.5 text-xs text-ink disabled:opacity-50"
		>
			<option value="auto">Auto-detect</option>
			{#each LOCALES as locale (locale)}
				<option value={locale}>{LOCALE_NAMES[locale]}</option>
			{/each}
			<option value="unsure">Not sure / mixed</option>
		</select>
	</label>
	{#if source === 'detected'}
		<p class="mt-1 text-[11px] text-muted">
			Detected: {detected ? LOCALE_NAMES[detected] : 'not enough text to tell'}
		</p>
	{/if}
</form>
