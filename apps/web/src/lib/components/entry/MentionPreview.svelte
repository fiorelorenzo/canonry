<script module lang="ts">
	// One id per mounted card, so `aria-describedby` on an anchor points at exactly this
	// card and not at a sibling prose block's. Never rendered on the server: the card only
	// exists once a pointer or a keyboard has reached a mention, which is client-only, so
	// these ids never appear in SSR markup and cannot mismatch on hydration.
	let cardSequence = 0;
</script>

<script lang="ts">
	/**
	 * Q3 of round twelve, #364: a `[[Mention]]` previews the entry it points at. T2 of round
	 * fifteen, #429: the preview is a property of any link that names an entry, not only a
	 * prose one - the sidebar's Recents list gets it too, mounted once in the shell rather
	 * than once per entry page.
	 *
	 * One card per mounted instance rather than one per mention, because prose mentions are
	 * not components: `renderMarkdown` hands the prose components an HTML string that goes
	 * into the DOM through `{@html}`, so those anchors are raw nodes nothing can be bound
	 * to, and every trigger is therefore delegated. This component listens on `container`
	 * and finds `[data-entry-slug]` with `closest` - the one marker `renderMarkdown`'s
	 * mention rule emits on its anchor and the sidebar's own Recents links carry too, read
	 * off directly rather than re-derived from the href (#429: the two surfaces' hrefs do
	 * not even share a shape, `/w/<universe>/e/<slug>` versus `/p/<universe>/<slug>`, so the
	 * attribute is the one thing both can carry without a second convention).
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
	import { resolve } from '$app/paths';
	import { messages, type Locale } from '$lib/i18n';
	import type { MentionSurface } from '$lib/markdown';
	import { createMentionPreviewLoader, type MentionPreviewData } from '$lib/mentionPreview';
	import { COVER_POSITION, COVER_RATIO } from '$lib/components/media/cover-crop';

	let {
		container,
		universeSlug,
		surface,
		locale
	}: {
		/** The element holding the links this instance watches - rendered prose, or the
		 * sidebar's `<aside>` for its Recents list (#429). Also the positioning context, so
		 * it has to be `position: relative`, and the card is a child of it. */
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
	/** The mention's own entity slug, captured alongside `data` in `open()`: the GM cover
	 * route needs it (`/w/<universe>/e/<entry>/media/<id>`, unlike the players' one) and
	 * `data-entry-slug` is read straight off the trigger, not itself reactive state, so it
	 * has to live here rather than be re-derived from `anchor` on every render. */
	let entitySlug = $state<string | null>(null);
	let left = $state(0);
	let top = $state(0);
	let width = $state(MAX_CARD_WIDTH);

	/** S6 (#411): built from the id alone, not carried as a ready URL from the server - the
	 * two surfaces' media routes have different shapes (the GM one needs the entity slug
	 * too, the players' one does not), and `resolve` only accepts a route it can match
	 * against the app's own generated route table, which means the template literal has to
	 * sit at this call site rather than come back from a helper typed `string` (that widens
	 * away the literal shape `resolve` checks against). `null` for both "no cover" and "no
	 * card open", which is the same nothing the markup below already treats identically. */
	let coverSrc = $derived(
		data?.coverId && entitySlug
			? surface === 'public'
				? resolve(`/p/${universeSlug}/media/${data.coverId}`)
				: resolve(`/w/${universeSlug}/e/${entitySlug}/media/${data.coverId}`)
			: null
	);

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
		entitySlug = null;
	}

	async function open(trigger: HTMLAnchorElement): Promise<void> {
		const root = container;
		const slug = trigger.dataset.entrySlug ?? null;
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
		entitySlug = slug;
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

		const entryLinkFrom = (target: EventTarget | null): HTMLAnchorElement | null =>
			target instanceof Element
				? (target.closest('a[data-entry-slug]') as HTMLAnchorElement | null)
				: null;

		const onPointerOver = (event: PointerEvent) => {
			if (event.pointerType !== 'mouse') return;
			const trigger = entryLinkFrom(event.target);
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
			const trigger = entryLinkFrom(event.target);
			if (!trigger) return;
			if (dismissed === trigger) dismissed = null;
			clearTimers();
			closeTimer = setTimeout(close, CLOSE_DELAY_MS);
		};

		const onFocusIn = (event: FocusEvent) => {
			const trigger = entryLinkFrom(event.target);
			if (trigger) schedule(trigger);
		};

		const onFocusOut = (event: FocusEvent) => {
			const trigger = entryLinkFrom(event.target);
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
		class="pointer-events-none absolute z-20 flex gap-3 rounded-md border border-line-2 bg-panel p-3 shadow-lg"
		style="left: {left}px; top: {top}px; width: {width}px"
	>
		{#if coverSrc}
			<!-- Sized from the ratio `cover-crop.ts` already keeps per entity type (S6, #411),
			     so the box is reserved before the image request even starts - the card never
			     resizes once the picture has loaded in. -->
			<span
				class="block shrink-0 overflow-hidden rounded border border-line bg-panel-2"
				style="width: 3rem; aspect-ratio: {COVER_RATIO[data.type]}"
			>
				<img
					src={coverSrc}
					alt={data.name}
					class="h-full w-full object-cover"
					style="object-position: {COVER_POSITION[data.type]}"
				/>
			</span>
		{/if}
		<span class="min-w-0 flex-1">
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
	</span>
{/if}
