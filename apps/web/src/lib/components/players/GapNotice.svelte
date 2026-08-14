<!--
	Decision E7 = C: an undiscovered entry is an honest gap page, not a hidden mention and
	not a bare 404. §10's own rule already implies the name is fair to show ("if it came up
	at the table it shows up" - a name spoken inside revealed prose already said this much);
	this is the page that says so plainly rather than pretending the link is broken.
-->
<script lang="ts">
	let { name, type }: { name: string; type: string } = $props();
</script>

<p class="rounded-md border border-dashed border-line-2 px-4 py-3 text-sm text-ink-2 italic">
	You have heard the name. Nobody at the table has learned enough about <b
		class="text-ink not-italic">{name}</b
	>
	for this {type} page to say more; yet.
</p>
