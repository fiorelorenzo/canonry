<script lang="ts">
	/**
	 * Round eleven P6, which reverses O2 (#284) narrowly: an entry with no cover shows a
	 * placeholder, and only to somebody who can write to that world.
	 *
	 * O2's reason for refusing one is the reason this file exists as its own component
	 * rather than as an absent branch inside `EntryCover.svelte`. That reason was a reader
	 * being shown an invitation they cannot accept, and it survives: `coverSlot` in
	 * `cover-crop.ts` decides whether this is mounted at all, on data the server resolved,
	 * and the players' wiki (`/p/<universe>/<slug>`) imports `EntryCover` alone, so that
	 * surface cannot render this even by mistake. A reader receives no slot in their HTML,
	 * not a slot hidden with CSS.
	 *
	 * Three things it borrows from the real band, because the point of a placeholder is that
	 * the page does not move when a cover arrives:
	 *
	 * 1. **The same per-type ratio**, `COVER_RATIO`, so a character's empty slot is the shape
	 *    a character's cover will be.
	 * 2. **The same cap**, `max-h-[20vh]`, so an entry with nothing in it does not open on a
	 *    large empty rectangle.
	 * 3. **The same box**: full width, rounded, one border. What differs is that the border
	 *    is dashed and there is no `<img>` at all - no broken-image glyph, no `alt` text
	 *    standing in for a picture that was never there, because nothing failed to load.
	 *
	 * **It is an affordance, not decoration.** Pressing it opens the aside's Images section,
	 * which is the existing image path (#66, #71): generate there, then "use as cover" is
	 * the accept. That keeps guardrail 1 exactly where O2 put it - this button starts no
	 * generation of its own and writes nothing, it is a door to the one mechanism that
	 * already exists, which is also why it carries no price and no model name (the panel it
	 * opens states both, and a second copy here would be a second answer to drift).
	 *
	 * Colours are the theme's own furniture tokens. Not the copilot's family: round eleven
	 * P2 is explicit that a hue marking chrome marks nothing, and an empty cover slot is
	 * furniture, with no word a model wrote anywhere near it.
	 */
	import type { EntityType } from '@canonry/db/schema';
	import { COVER_RATIO } from './cover-crop';
	import { messages, type Locale } from '$lib/i18n';

	let {
		entityType,
		onStart,
		locale
	}: { entityType: EntityType; onStart: () => void; locale: Locale } = $props();

	let t = $derived(messages(locale).entry.cover);
	let ratio = $derived(COVER_RATIO[entityType]);
</script>

<button
	type="button"
	onclick={onStart}
	class="mb-6 flex max-h-[20vh] w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line-2 bg-panel-2 px-4 text-center text-muted hover:border-accent hover:bg-panel hover:text-accent-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
	style="aspect-ratio: {ratio}"
>
	<span class="text-sm font-medium">{t.placeholderAction}</span>
	<span class="text-xs">{t.placeholderHint}</span>
</button>
