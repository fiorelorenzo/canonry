<script lang="ts" module>
	import type { MentionTarget } from '$lib/markdown';

	/** What the preview needs that the writing surface does not, passed straight through
	 * from the entry route's `load`. Optional at the call site for the same reason
	 * `ImageInsertContext` is: the works/node editor mounts this component with no entity
	 * behind it, so there is no entry page for its preview to agree with, and it gets the
	 * writing surface alone rather than a preview that renders through a different
	 * component than the one its own reader will see. */
	export interface EditorPreviewContext {
		universeSlug: string;
		/** `publicMentionTargetsFrom(mentionTargets)`, computed server-side in the route's
		 * own `load` (#220) exactly as the read page computes it: this is what
		 * `EntryProseWithSecrets` resolves mentions against inside its player preview, and
		 * deriving it here in the browser would mean a second copy of the `gm_only` rule. */
		publicMentionTargets: MentionTarget[];
	}
</script>

<script lang="ts">
	/**
	 * The editor, B2 = C and G4 = A: text stays markdown (the `<textarea>` underneath is
	 * the actual stored form, character for character), decorated live by laying a
	 * read-only backdrop of `decorate.ts`'s output directly behind a transparent textarea -
	 * the two stay pixel-aligned because they are, character for character, the same
	 * string. A real `<textarea>` is what's typed into, so the browser owns typing, the
	 * caret, undo/redo and IME composition; this component only restores the selection
	 * after a *programmatic* edit (a toolbar click or a mention pick), never during typing.
	 *
	 * Round twelve, Q4, adds the preview, and the shape it takes falls out of the two
	 * layers above rather than out of taste. A live third layer is the one thing this
	 * component cannot have: the backdrop is behind the textarea *because* the two are the
	 * same string at the same pixels, and a rendered preview is neither. Side by side is
	 * out for a different reason: the reading room sets prose at a measure, and half of
	 * `max-w-3xl` is narrower than that, so a two-column preview would misreport every
	 * line break and heading rhythm it exists to show, and at 390px there is no second
	 * column at all. So it is a **write/preview switch over one box**: the preview reads
	 * at the width the writing does, there is one thing on screen at a time, and the
	 * phone gets the same feature as the desktop instead of a degraded one.
	 *
	 * The write layers are hidden rather than unmounted when the preview shows. Removing
	 * the textarea from the DOM would throw away the browser's own undo stack and the
	 * caret with it, so a round trip through the preview would quietly cost the writer
	 * their history.
	 *
	 * What renders the preview is `EntryProseWithSecrets`, the entry page's own body
	 * component, not a second renderer: same `renderMarkdown`, same `MentionTarget` set,
	 * same secret and GM-note fences with the same tags, and the same player-preview
	 * toggle. A preview that could disagree with the page would be worse than none, and
	 * the only way to be sure it cannot is for it to be the page's component.
	 */
	import { decorateMarkdown } from './decorate';
	import FormattingToolbar, { type FormatCommand } from './FormattingToolbar.svelte';
	import MentionMenu from './MentionMenu.svelte';
	import ImageInsertDialog, { type ImageInsertContext } from '../media/ImageInsertDialog.svelte';
	import ImageWidthControl from './ImageWidthControl.svelte';
	import EntryProseWithSecrets from '../players/EntryProseWithSecrets.svelte';
	import { Segmented, type SegmentedOption } from '$lib/components/ui/segmented';
	import {
		applyMentionSelection,
		findActiveTrigger,
		insertImage,
		insertLink,
		insertMentionTrigger,
		matchTargets,
		mentionMenuKeyAction,
		toggleLinePrefix,
		wrapSelection,
		type MentionMenuKey,
		type TextEdit
	} from './editorState';
	import { messages, type Locale } from '$lib/i18n';
	import type { ImageWidthPercent } from '$lib/markdown';
	// `MentionTarget` is imported by the module block above, whose scope this one sees.

	let {
		value = $bindable(''),
		targets,
		locale,
		imageInsert,
		preview
	}: {
		value: string;
		targets: MentionTarget[];
		locale: Locale;
		/** Only the entry editor passes this (issue #253) - the works/node editor mounts
		 * this same component with no entity behind it, so the toolbar's image button
		 * stays hidden there rather than opening a picker with nothing to place. */
		imageInsert?: ImageInsertContext;
		/** Round twelve, Q4: present means this editor has a reading surface to agree
		 * with, and gains the write/preview switch. Absent means write only. */
		preview?: EditorPreviewContext;
	} = $props();
	let t = $derived(messages(locale));

	// A plain string because that is what `Segmented` binds: it is a group of native
	// radios, whose value is a string, and narrowing it to a union here would buy nothing
	// the one comparison below does not already give.
	let view = $state('write');
	let showPreview = $derived(preview !== undefined && view === 'preview');
	let viewOptions = $derived<SegmentedOption[]>([
		{ value: 'write', label: t.entry.editor.view.write },
		{ value: 'preview', label: t.entry.editor.view.preview }
	]);

	let textareaEl: HTMLTextAreaElement | undefined = $state();
	let backdropEl: HTMLDivElement | undefined = $state();
	let previewEl: HTMLDivElement | undefined = $state();
	let caret = $state(0);
	let dismissedTriggerStart = $state<number | null>(null);
	let highlightedIndex = $state(0);
	let imageDialogOpen = $state(false);
	// Captured when the toolbar button opens the dialog, not read again once it's open:
	// the dialog is modal (round thirteen R2, #377: the vendored Dialog, not a native
	// <dialog> anymore), so the textarea's own selection can't move underneath it while
	// the user is picking or generating an image.
	let pendingImageSelection = { start: 0, end: 0 };

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

	// R9, round thirteen (#384): raised from `min-h-64` so a short entry, in write or in
	// preview, does not move the box under the switch that just changed it - the floor
	// both modes share. The preview wrapper below caps its own images to match.
	const editorBoxClasses =
		'min-h-96 w-full resize-y whitespace-pre-wrap break-words px-4 py-3 text-[15px] leading-relaxed';

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
		else if (command === 'image') {
			pendingImageSelection = { start, end };
			imageDialogOpen = true;
		} else applyEdit(insertMentionTrigger(value, start, end));
	}

	/** Passed to `ImageInsertDialog` as `onInsert`: the dialog already resolved which
	 * asset (existing, or freshly generated and attached) and handed back the URL to
	 * write, plus the width the GM chose there (#384) - this just runs both through the
	 * same `applyEdit` every other command uses. */
	function insertImageAtSelection(url: string, widthPercent: ImageWidthPercent): void {
		applyEdit(
			insertImage(value, pendingImageSelection.start, pendingImageSelection.end, url, widthPercent)
		);
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
	<!-- One bar over the box, holding the formatting toolbar at one end and, where there
	     is a reading surface to agree with, the write/preview switch at the other. The
	     chrome lives here rather than in `FormattingToolbar` so both halves sit inside the
	     same border; it wraps at 390px, where the switch drops under the icons. -->
	<div
		class="flex flex-wrap items-center justify-between gap-2 rounded-t-lg border border-b-0 border-line-2 bg-panel-2 p-1.5"
	>
		<FormattingToolbar
			onCommand={runCommand}
			{locale}
			imageInsertEnabled={!!imageInsert}
			disabled={showPreview}
		/>
		{#if preview}
			<!-- O4 = B: a binary state gets a segmented control, and this one is a view
			     switch rather than a field, so it deliberately sits outside the entry
			     form (see the edit route's own comment) and posts nothing. -->
			<Segmented
				name="editor-view"
				bind:value={view}
				options={viewOptions}
				ariaLabel={t.entry.editor.view.ariaLabel}
				class="shrink-0"
			/>
		{/if}
	</div>

	<div
		class="relative overflow-hidden rounded-b-lg border border-line-2 bg-panel"
		class:hidden={showPreview}
	>
		<div
			bind:this={backdropEl}
			class="{editorBoxClasses} pointer-events-none absolute inset-0 overflow-auto text-ink-2 select-none"
			aria-hidden="true"
		>
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- decorate.ts escapes raw text -->
			{@html decorated}
		</div>
		<!-- #147: this textarea stays native. Its text is transparent on purpose - the
			decorated backdrop behind it is the visible surface, and the two are aligned
			pixel for pixel by sharing editorBoxClasses; a shadcn Textarea's own border,
			background and padding would break that alignment and double the chrome. -->
		<textarea
			bind:this={textareaEl}
			bind:value
			class="{editorBoxClasses} relative resize-y bg-transparent text-transparent caret-ink outline-none"
			spellcheck="false"
			aria-label={t.entry.editor.bodyAriaLabel}
			oninput={trackCaret}
			onkeyup={trackCaret}
			onclick={trackCaret}
			onscroll={syncScroll}
			onkeydown={handleKeydown}></textarea>
	</div>

	{#if !showPreview && menuOpen && trigger}
		<MentionMenu
			query={trigger.query}
			{matches}
			highlightedIndex={effectiveHighlight}
			onSelect={selectMention}
			{locale}
		/>
	{/if}

	{#if preview && showPreview}
		<!-- `min-h-96` is the writing box's own floor (R9, #384), so switching does not
		     make the page jump under the switch that caused it. `[&_img]:max-h-64
		     [&_img]:object-contain` is the other half of that fix: a portrait, at any
		     chosen width, cannot grow the box past a sane cap here - the real entry page
		     carries neither rule, only this preview does. `relative` is
		     `ImageWidthControl`'s positioning context, the same contract
		     `MentionPreview.svelte` already relies on inside `EntryProseWithSecrets`. -->
		<div
			bind:this={previewEl}
			class="relative min-h-96 rounded-b-lg border border-line-2 bg-panel px-4 py-3 [&_img]:max-h-64 [&_img]:object-contain"
			role="region"
			aria-label={t.entry.editor.view.previewAriaLabel}
		>
			{#if value.trim()}
				<EntryProseWithSecrets
					body={value}
					universeSlug={preview.universeSlug}
					mentionTargets={targets}
					publicMentionTargets={preview.publicMentionTargets}
					{locale}
				/>
				<ImageWidthControl container={previewEl ?? null} {value} {locale} onApply={applyEdit} />
			{:else}
				<p class="text-sm text-muted">{t.entry.editor.view.previewEmpty}</p>
			{/if}
		</div>
	{/if}

	{#if imageInsert}
		<ImageInsertDialog
			bind:open={imageDialogOpen}
			universeSlug={imageInsert.universeSlug}
			entrySlug={imageInsert.entrySlug}
			assets={imageInsert.assets}
			aiEnabled={imageInsert.aiEnabled}
			scene={imageInsert.scene}
			onInsert={insertImageAtSelection}
			{locale}
		/>
	{/if}
</div>
