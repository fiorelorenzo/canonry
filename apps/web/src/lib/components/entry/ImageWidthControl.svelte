<script lang="ts">
	/**
	 * R9, round thirteen (#384): hovering or focusing an image in the editor's preview
	 * offers the same three widths `ImageInsertDialog.svelte` offers on insert, and
	 * rewrites the token in place through `setImageWidth` + the same `applyEdit` the
	 * toolbar's own commands use, so undo and caret restore keep working.
	 *
	 * The preview is `EntryProseWithSecrets`'s `{@html}` output - raw DOM nodes nothing
	 * can bind to - so, like `MentionPreview.svelte` before it, this delegates: one
	 * listener on `container`, `closest('img')` finds the trigger, `getBoundingClientRect`
	 * places an absolutely positioned control over its corner. Unlike `MentionPreview`'s
	 * read-only card, this one is a real control the pointer has to reach, so both the
	 * image and the control itself keep it open - `relatedTarget` on `pointerout`/
	 * `focusout` says whether the pointer or focus is moving between the two or leaving
	 * both.
	 *
	 * `findImageTokens` (`editorState.ts`) scans the same raw `value` markdown-it renders,
	 * in the same left-to-right order it renders images in, so the Nth `<img>` in the DOM
	 * and the Nth token in that list name the same image - confirmed against the rendered
	 * `src` before ever trusting the match, so a body whose images don't line up with the
	 * DOM (the "Player preview" toggle inside `EntryProseWithSecrets` can strip one that
	 * lives inside a secret block) simply offers no control rather than rewriting the
	 * wrong one.
	 */
	import { findImageTokens, setImageWidth, type ImageToken, type TextEdit } from './editorState';
	import { IMAGE_WIDTH_PERCENTS, type ImageWidthPercent } from '$lib/markdown';
	import { Segmented, type SegmentedOption } from '$lib/components/ui/segmented';
	import { messages, type Locale } from '$lib/i18n';

	let {
		container,
		value,
		locale,
		onApply
	}: {
		/** The preview's own wrapper element in `MarkdownEditor.svelte` - has to be
		 * `position: relative`, and this control is an absolutely positioned child of it,
		 * the same contract `MentionPreview.svelte`'s own `container` prop carries. */
		container: HTMLElement | null;
		value: string;
		locale: Locale;
		onApply: (edit: TextEdit) => void;
	} = $props();

	let t = $derived(messages(locale).entry.editor.imageWidth);
	let tokens = $derived(findImageTokens(value));
	let widthOptions = $derived<SegmentedOption[]>(
		IMAGE_WIDTH_PERCENTS.map((percent) => ({
			value: `${percent}`,
			label: percent === 33 ? t.third : percent === 67 ? t.twoThirds : t.full
		}))
	);

	const CLOSE_DELAY_MS = 140;

	let activeImg = $state<HTMLImageElement | null>(null);
	let activeToken = $state<ImageToken | null>(null);
	let left = $state(0);
	let top = $state(0);
	let closeTimer: ReturnType<typeof setTimeout> | null = null;

	let widthValue = $derived(activeToken?.widthPercent != null ? `${activeToken.widthPercent}` : '');

	function clearCloseTimer(): void {
		if (closeTimer !== null) clearTimeout(closeTimer);
		closeTimer = null;
	}

	function close(): void {
		clearCloseTimer();
		activeImg = null;
		activeToken = null;
	}

	/** The token whose rendered `<img>` is `img`, by its position among the container's
	 * own `<img>` elements - confirmed against `src` so a mismatch fails closed rather
	 * than rewriting the wrong image (see the header comment). */
	function tokenFor(img: HTMLImageElement): ImageToken | null {
		if (!container) return null;
		const index = Array.from(container.querySelectorAll('img')).indexOf(img);
		const token = index >= 0 ? tokens[index] : undefined;
		return token && token.url === img.getAttribute('src') ? token : null;
	}

	function open(img: HTMLImageElement): void {
		const root = container;
		const token = tokenFor(img);
		if (!root || !token) return;
		clearCloseTimer();
		const containerRect = root.getBoundingClientRect();
		const imgRect = img.getBoundingClientRect();
		left = imgRect.left - containerRect.left + 6;
		top = imgRect.top - containerRect.top + 6;
		activeImg = img;
		activeToken = token;
	}

	function pick(widthPercent: string): void {
		if (!activeToken) return;
		onApply(setImageWidth(value, activeToken, Number(widthPercent) as ImageWidthPercent));
		close();
	}

	$effect(() => {
		const root = container;
		if (!root) return;

		// True when `target` is the currently active image, or lands inside this
		// component's own floating control - either one keeps the control open.
		const inZone = (target: EventTarget | null): boolean => {
			if (!(target instanceof Element)) return false;
			if (activeImg && target === activeImg) return true;
			return target.closest('[data-image-width-control]') !== null;
		};

		const imgFrom = (target: EventTarget | null): HTMLImageElement | null => {
			if (!(target instanceof Element)) return null;
			const el = target.closest('img');
			return el instanceof HTMLImageElement ? el : null;
		};

		const onPointerOver = (event: PointerEvent) => {
			if (event.pointerType !== 'mouse') return;
			if (inZone(event.target)) {
				clearCloseTimer();
				return;
			}
			const img = imgFrom(event.target);
			if (img) open(img);
		};

		const onPointerOut = (event: PointerEvent) => {
			if (event.pointerType !== 'mouse') return;
			if (!inZone(event.target)) return;
			if (inZone(event.relatedTarget)) return;
			clearCloseTimer();
			closeTimer = setTimeout(close, CLOSE_DELAY_MS);
		};

		const onFocusIn = (event: FocusEvent) => {
			const img = imgFrom(event.target);
			if (img) open(img);
		};

		const onFocusOut = (event: FocusEvent) => {
			if (!inZone(event.target)) return;
			if (inZone(event.relatedTarget)) return;
			close();
		};

		root.addEventListener('pointerover', onPointerOver);
		root.addEventListener('pointerout', onPointerOut);
		root.addEventListener('focusin', onFocusIn);
		root.addEventListener('focusout', onFocusOut);
		return () => {
			root.removeEventListener('pointerover', onPointerOver);
			root.removeEventListener('pointerout', onPointerOut);
			root.removeEventListener('focusin', onFocusIn);
			root.removeEventListener('focusout', onFocusOut);
			close();
		};
	});

	// Images gain focusability only here, only for the lifetime of this control: a plain
	// `<img>` is unreachable by keyboard, which the read page is right to leave alone, but
	// this affordance has to be reachable without a mouse too (round two's G3).
	$effect(() => {
		const root = container;
		if (!root) return;
		const imgs = Array.from(root.querySelectorAll('img'));
		for (const img of imgs) img.tabIndex = 0;
		return () => {
			for (const img of imgs) img.removeAttribute('tabindex');
		};
	});
</script>

<!-- Escape on the window rather than on the control: it can be dismissed while the
     textarea (not this control) holds focus, exactly like `MentionPreview.svelte`'s
     own reasoning for the same choice. -->
<svelte:window onkeydown={(event) => event.key === 'Escape' && activeImg && close()} />

{#if activeImg && activeToken}
	<div
		data-image-width-control
		class="absolute z-20 rounded-md border border-line-2 bg-panel p-1 shadow-lg"
		style="left: {left}px; top: {top}px"
	>
		<Segmented
			name="preview-image-width"
			value={widthValue}
			onchange={pick}
			options={widthOptions}
			ariaLabel={t.ariaLabel}
		/>
	</div>
{/if}
