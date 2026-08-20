<script module lang="ts">
	// One id per mounted card, so `aria-describedby` on an anchor points at exactly this
	// card and not at a sibling prose block's. Never rendered on the server: the card only
	// exists once a pointer or a keyboard has reached a mention, which is client-only, so
	// these ids never appear in SSR markup and cannot mismatch on hydration.
	let cardSequence = 0;
</script>

<script lang="ts">
	/**
	 * Q3 of round twelve, #364: a `[[Mention]]` previews the entry it points at.
	 *
	 * One card per prose block rather than one per mention, because the mentions are not
	 * components. `renderMarkdown` hands the prose components an HTML string that goes into
	 * the DOM through `{@html}`, so the anchors are raw nodes nothing can be bound to, and
	 * every trigger is therefore delegated: this component listens on the prose container
	 * and finds `a.mention` with `closest`.
	 *
	 * That is also why `ui/popover/` is not used here, despite it being vendored. It wraps
	 * bits-ui's `Popover`, which owns its own trigger element as a component, and there is no
	 * trigger component to give it. The precedent this follows is the one that already exists
	 * for the same reason: `EvidencePopover.svelte` (C5) hand-rolls an absolutely positioned
	 * box too, so nothing is introduced here that the app did not already have.
	 *
	 * Behaviour, as the issue specifies it:
	 *
	 * - Hover and focus both, so a keyboard reader tabbing through prose gets the same
	 *   affordance a mouse does. Focus never moves into the card: the anchor keeps it and the
	 *   card is described by `aria-describedby`, never entered, and it is `pointer-events-
	 *   none` so it can neither be hovered nor swallow a click on the text under it.
	 * - A delay before it opens, and the card only appears once its data has arrived, so a
	 *   pointer brushing across a line of prose neither fires a request nor flashes an empty
	 *   box.
	 * - Escape dismisses it, and keeps it dismissed for that one mention until the pointer or
	 *   the focus leaves, so it does not spring straight back under a stationary cursor.
	 * - Touch does nothing, deliberately. There is no hover on a phone, a tap already follows
	 *   the link (which is the whole answer to "who is this"), and the long press that would
	 *   be left belongs to the browser's own context menu. `pointerType` is the gate, so a
	 *   mouse plugged into a tablet still previews.
	 */
	import { messages, type Locale } from '$lib/i18n';
	import type { MentionSurface } from '$lib/markdown';
	import {
		createMentionPreviewLoader,
		mentionSlugFromHref,
		type MentionPreviewData
	} from '$lib/mentionPreview';

	let {
		container,
		universeSlug,
		surface,
		locale
	}: {
		/** The element holding the rendered prose. Also the positioning context, so it has to
		 * be `position: relative`, and the card is a child of it. */
		container: HTMLElement | null;
		universeSlug: string;
		/** Follows the surface the prose was *rendered* for, not the route it sits on: the
		 * GM's own player preview renders with public hrefs and public targets, so its cards
		 * come from the public endpoint too and show a GM exactly what a player would see. */
		surface: MentionSurface;
		locale: Locale;
	} = $props();

	const OPEN_DELAY_MS = 220;
	const CLOSE_DELAY_MS = 140;
	const MAX_CARD_WIDTH = 320;

	cardSequence += 1;
	const cardId = `mention-preview-${cardSequence}`;
	let t = $derived(messages(locale).mentionPreview);
	const load = createMentionPreviewLoader();

	let anchor = $state<HTMLAnchorElement | null>(null);
	let data = $state<MentionPreviewData | null>(null);
	let left = $state(0);
	let top = $state(0);
	let width = $state(MAX_CARD_WIDTH);

	let openTimer: ReturnType<typeof setTimeout> | null = null;
	let closeTimer: ReturnType<typeof setTimeout> | null = null;
	/** The one anchor Escape has dismissed, cleared when the pointer or focus leaves it.
	 * Per anchor rather than a flag, so dismissing one mention's card does not mute the next
	 * mention the reader moves onto. */
	let dismissed: Element | null = null;
	/** Invalidates an in-flight request whose anchor the reader has already left. */
	let generation = 0;

	function clearTimers(): void {
		if (openTimer !== null) clearTimeout(openTimer);
		if (closeTimer !== null) clearTimeout(closeTimer);
		openTimer = null;
		closeTimer = null;
	}

	function close(): void {
		clearTimers();
		generation += 1;
		anchor?.removeAttribute('aria-describedby');
		anchor = null;
		data = null;
	}

	async function open(trigger: HTMLAnchorElement): Promise<void> {
		const root = container;
		const slug = mentionSlugFromHref(trigger.getAttribute('href') ?? '');
		if (!root || !slug) return;
		const mine = ++generation;
		const found = await load(surface, universeSlug, slug);
		// Stale (the reader moved on while this was in flight), or nothing to preview - a
		// `gm_only` entry on the public surface among other reasons, which is the same
		// nothing as a name nobody owns.
		if (mine !== generation || !found) return;

		// Measured now rather than before the fetch: prose reflows, and an anchor that
		// wrapped onto another line in between would otherwise anchor the card to where it
		// used to be. Both rects are viewport-relative, so the difference is the offset
		// inside the container's own box, which is what `position: absolute` wants.
		const containerRect = root.getBoundingClientRect();
		const anchorRect = trigger.getBoundingClientRect();
		width = Math.min(MAX_CARD_WIDTH, root.clientWidth);
		left = Math.min(Math.max(0, anchorRect.left - containerRect.left), root.clientWidth - width);
		top = anchorRect.bottom - containerRect.top + 6;
		data = found;
		anchor = trigger;
		trigger.setAttribute('aria-describedby', cardId);
	}

	function schedule(trigger: HTMLAnchorElement): void {
		if (dismissed === trigger) return;
		clearTimers();
		openTimer = setTimeout(() => void open(trigger), OPEN_DELAY_MS);
	}

	$effect(() => {
		const root = container;
		if (!root) return;

		const mentionFrom = (target: EventTarget | null): HTMLAnchorElement | null =>
			target instanceof Element ? (target.closest('a.mention') as HTMLAnchorElement | null) : null;

		const onPointerOver = (event: PointerEvent) => {
			if (event.pointerType !== 'mouse') return;
			const trigger = mentionFrom(event.target);
			if (!trigger) return;
			// Already showing this one: cancel the pending close a `pointerout` from the
			// previous line of a wrapped anchor may have queued.
			if (trigger === anchor) {
				clearTimers();
				return;
			}
			schedule(trigger);
		};

		const onPointerOut = (event: PointerEvent) => {
			if (event.pointerType !== 'mouse') return;
			const trigger = mentionFrom(event.target);
			if (!trigger) return;
			if (dismissed === trigger) dismissed = null;
			clearTimers();
			closeTimer = setTimeout(close, CLOSE_DELAY_MS);
		};

		const onFocusIn = (event: FocusEvent) => {
			const trigger = mentionFrom(event.target);
			if (trigger) schedule(trigger);
		};

		const onFocusOut = (event: FocusEvent) => {
			const trigger = mentionFrom(event.target);
			if (!trigger) return;
			if (dismissed === trigger) dismissed = null;
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
</script>

<!-- Escape on the window rather than on the anchor: a card opened by hover has the keyboard
     focus somewhere else entirely, so a handler on the trigger would never see the key. It
     neither preventDefaults nor stops propagation, and does nothing at all unless a card is
     open, so no other Escape handler on the page loses its event. -->
<svelte:window
	onkeydown={(event) => {
		if (event.key !== 'Escape' || anchor === null) return;
		dismissed = anchor;
		close();
	}}
/>

{#if data}
	<span
		id={cardId}
		role="tooltip"
		class="pointer-events-none absolute z-20 block rounded-md border border-line-2 bg-panel p-3 shadow-lg"
		style="left: {left}px; top: {top}px; width: {width}px"
	>
		<span class="block text-sm font-semibold text-ink">{data.name}</span>
		<!-- `text-ink-2` and not `text-muted`: at 10px the muted ink is 4.13:1 on `bg-panel`,
		     which axe fails and a phone in daylight fails harder. The mono uppercase is what
		     makes this read as a label, not the lighter colour. -->
		<span class="mt-0.5 block font-mono text-[10px] tracking-wide text-ink-2 uppercase">
			{data.type}
		</span>
		{#if data.status === 'gap'}
			<span class="mt-1.5 block text-xs text-ink-2 italic">{t.gap}</span>
		{:else if data.excerpt}
			<span class="mt-1.5 line-clamp-4 block text-xs text-ink-2">{data.excerpt}</span>
		{:else}
			<span class="mt-1.5 block text-xs text-ink-2 italic">{t.empty}</span>
		{/if}
	</span>
{/if}
