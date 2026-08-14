<script lang="ts">
	/**
	 * The editor, B2 = C and G4 = A: text stays markdown (the `<textarea>` underneath is
	 * the actual stored form, character for character), decorated live by laying a
	 * read-only backdrop of `decorate.ts`'s output directly behind a transparent textarea -
	 * the two stay pixel-aligned because they are, character for character, the same
	 * string. A real `<textarea>` is what's typed into, so the browser owns typing, the
	 * caret, undo/redo and IME composition; this component only restores the selection
	 * after a *programmatic* edit (a toolbar click or a mention pick), never during typing.
	 */
	import { decorateMarkdown } from './decorate';
	import FormattingToolbar, { type FormatCommand } from './FormattingToolbar.svelte';
	import MentionMenu from './MentionMenu.svelte';
	import {
		applyMentionSelection,
		findActiveTrigger,
		insertLink,
		insertMentionTrigger,
		matchTargets,
		mentionMenuKeyAction,
		toggleLinePrefix,
		wrapSelection,
		type MentionMenuKey,
		type TextEdit
	} from './editorState';
	import type { MentionTarget } from '$lib/markdown';

	let {
		value = $bindable(''),
		targets
	}: {
		value: string;
		targets: MentionTarget[];
	} = $props();

	let textareaEl: HTMLTextAreaElement | undefined = $state();
	let backdropEl: HTMLDivElement | undefined = $state();
	let caret = $state(0);
	let dismissedTriggerStart = $state<number | null>(null);
	let highlightedIndex = $state(0);

	let decorated = $derived(decorateMarkdown(value, targets));
	let trigger = $derived(findActiveTrigger(value, caret));
	let menuOpen = $derived(trigger !== null && trigger.start !== dismissedTriggerStart);
	let matches = $derived(trigger ? matchTargets(targets, trigger.query) : []);
	// Clamped rather than trusted directly: the list can shrink as a query narrows, and a
	// stale index from a longer list must not point past the end of a shorter one.
	let effectiveHighlight = $derived(Math.min(highlightedIndex, Math.max(0, matches.length - 1)));

	// A fresh trigger, or a narrower query on the same one, always starts the highlight
	// back at the top match, so Enter works immediately without arrowing first - the same
	// convention autocomplete menus elsewhere already use.
	$effect(() => {
		if (trigger) highlightedIndex = 0;
	});

	const editorBoxClasses =
		'min-h-64 w-full resize-y whitespace-pre-wrap break-words px-4 py-3 text-[15px] leading-relaxed';

	function applyEdit(edit: TextEdit): void {
		value = edit.source;
		caret = edit.selectionStart;
		// `value = ...` above rewrites the textarea's DOM value, which resets its caret to
		// the end; restore the real selection once that write has landed.
		queueMicrotask(() => {
			textareaEl?.focus();
			textareaEl?.setSelectionRange(edit.selectionStart, edit.selectionEnd);
		});
	}

	function currentSelection(): { start: number; end: number } {
		return {
			start: textareaEl?.selectionStart ?? value.length,
			end: textareaEl?.selectionEnd ?? value.length
		};
	}

	function runCommand(command: FormatCommand): void {
		const { start, end } = currentSelection();
		if (command === 'bold') applyEdit(wrapSelection(value, start, end, '**'));
		else if (command === 'italic') applyEdit(wrapSelection(value, start, end, '*'));
		else if (command === 'heading') applyEdit(toggleLinePrefix(value, start, end, '## '));
		else if (command === 'list') applyEdit(toggleLinePrefix(value, start, end, '- '));
		else if (command === 'quote') applyEdit(toggleLinePrefix(value, start, end, '> '));
		else if (command === 'link') applyEdit(insertLink(value, start, end));
		else applyEdit(insertMentionTrigger(value, start, end));
	}

	function selectMention(target: MentionTarget): void {
		if (!trigger) return;
		applyEdit(applyMentionSelection(value, trigger, caret, target));
	}

	function trackCaret(): void {
		caret = textareaEl?.selectionStart ?? value.length;
	}

	function syncScroll(): void {
		if (backdropEl && textareaEl) {
			backdropEl.scrollTop = textareaEl.scrollTop;
			backdropEl.scrollLeft = textareaEl.scrollLeft;
		}
	}

	const MENTION_MENU_KEYS: MentionMenuKey[] = ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'];

	function isMentionMenuKey(key: string): key is MentionMenuKey {
		return (MENTION_MENU_KEYS as string[]).includes(key);
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (!menuOpen || !trigger || !isMentionMenuKey(event.key)) return;

		const action = mentionMenuKeyAction(event.key, effectiveHighlight, matches.length);
		if (action.type === 'ignore') return;
		// Enter and Tab keep their ordinary behaviour (a newline, leaving the field) the
		// rest of the time; only intercepted while a mention is actually being resolved.
		event.preventDefault();

		if (action.type === 'move') {
			highlightedIndex = action.index;
		} else if (action.type === 'accept') {
			const target = matches[action.index];
			if (target) selectMention(target);
		} else {
			dismissedTriggerStart = trigger.start;
		}
	}
</script>

<div>
	<FormattingToolbar onCommand={runCommand} />

	<div class="relative overflow-hidden rounded-b-lg border border-line-2 bg-panel">
		<div
			bind:this={backdropEl}
			class="{editorBoxClasses} pointer-events-none absolute inset-0 overflow-auto text-ink-2 select-none"
			aria-hidden="true"
		>
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- decorate.ts escapes raw text -->
			{@html decorated}
		</div>
		<textarea
			bind:this={textareaEl}
			bind:value
			class="{editorBoxClasses} relative resize-y bg-transparent text-transparent caret-ink outline-none"
			spellcheck="false"
			aria-label="Entry body, markdown"
			oninput={trackCaret}
			onkeyup={trackCaret}
			onclick={trackCaret}
			onscroll={syncScroll}
			onkeydown={handleKeydown}></textarea>
	</div>

	{#if menuOpen && trigger}
		<MentionMenu
			query={trigger.query}
			{matches}
			highlightedIndex={effectiveHighlight}
			onSelect={selectMention}
		/>
	{/if}
</div>
