<!--
	Issue #791: the players page used to open on a boxed card - a heading repeating
	"the players' wiki", the address on its own line, a button, a share sentence, all
	inside a bordered panel with 20px of padding on every side. That much chrome for
	one address and one link read as a form, not a page. This row says the same three
	things (the address, the one action, the one sentence of context) at the weight
	they actually carry: the address is copyable chrome, not prose, so it is a pill
	with a copy affordance rather than a paragraph in `font-mono`; the action is a
	button beside it, not below it; the share sentence is a single quiet line, not a
	second paragraph in the same box.

	Guardrail 6 stays untouched by construction - this row still only reads the
	address and opens it in a new tab. No invitation exists anywhere in the product
	(the doc comment on `+page.server.ts` says so), so `invitationsNotice` still says
	that in one sentence rather than the row growing a button that writes nothing.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { messages, type Locale } from '$lib/i18n';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';

	let { universeSlug, locale }: { universeSlug: string; locale: Locale } = $props();

	let t = $derived(messages(locale).universe.players);
	let wikiPath = $derived(resolve(`/p/${universeSlug}`));

	let copied = $state(false);
	let copyResetTimer: ReturnType<typeof setTimeout> | undefined;

	async function copyAddress() {
		try {
			await navigator.clipboard.writeText(wikiPath);
		} catch {
			// Clipboard access can fail (permissions, a non-secure context) - the address
			// is still right there in the pill, selectable by hand, so a silent failure
			// costs nothing worth a toast over.
			return;
		}
		copied = true;
		clearTimeout(copyResetTimer);
		copyResetTimer = setTimeout(() => {
			copied = false;
		}, 2000);
	}
</script>

<div
	class="flex flex-col gap-1.5 border-b border-line pb-6"
	role="group"
	aria-label={t.wikiLinkLabel}
>
	<div class="flex flex-wrap items-center gap-2.5">
		<button
			type="button"
			onclick={copyAddress}
			class="inline-flex items-center gap-2 rounded-full border border-line-2 bg-panel-2 px-3 py-1.5 font-mono text-label text-ink-2 transition-colors hover:bg-panel hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
			aria-label={copied ? t.addressCopiedLabel : t.copyAddressLabel(wikiPath)}
		>
			<span>{wikiPath}</span>
			{#if copied}
				<CheckIcon aria-hidden="true" class="size-3.5 text-accent-ink" />
			{:else}
				<CopyIcon aria-hidden="true" class="size-3.5" />
			{/if}
		</button>
		<Button href={wikiPath} target="_blank" rel="noopener" size="sm">
			{t.openWikiLink}
			<ExternalLinkIcon aria-hidden="true" class="size-3.5" />
		</Button>
	</div>
	<p class="text-label text-muted">{t.invitationsNotice}</p>
</div>
