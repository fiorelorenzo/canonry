<!--
	Decision E7 = C: an undiscovered entry is an honest gap page, not a hidden mention and
	not a bare 404. §10's own rule already implies the name is fair to show ("if it came up
	at the table it shows up" - a name spoken inside revealed prose already said this much);
	this is the page that says so plainly rather than pretending the link is broken.

	Issue #127: `locale` picks the chrome sentence; `name` and `type` are canon (a name,
	never translated - SPEC.md §17 - and the raw, untranslated type enum the rest of this
	surface already leaves alone), so they sit outside the translated string entirely
	rather than being interpolated into it.
-->
<script lang="ts">
	import { messages, type Locale } from '$lib/i18n';

	let { name, type, locale }: { name: string; type: string; locale: Locale } = $props();
	let t = $derived(messages(locale));
</script>

<p class="rounded-md border border-dashed border-line-2 px-4 py-3 text-sm text-ink-2 italic">
	{t.players.gapNoticeBefore}
	<b class="text-ink not-italic">{name}</b>
	{t.players.gapNoticeAfter(type)}
</p>
