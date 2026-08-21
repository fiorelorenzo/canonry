<script lang="ts">
	/**
	 * #106: a component gallery for C1 = B's marking, not a product surface. Proposals
	 * don't exist in the database yet (#47), so this page renders the component against
	 * the fixture paragraph directly rather than faking a proposal row into a real entry.
	 */
	import { page } from '$app/state';
	import AiMarkedParagraph from '$lib/components/ai/AiMarkedParagraph.svelte';
	import type { ParagraphSegment } from '$lib/components/ai/aiMarking';

	const oneSentence: ParagraphSegment[] = [
		{
			text: 'Captain of the Valdoria Watch, forty sworn under him in the Lantern Quarter.',
			proposed: true
		}
	];

	// The artifact's own worst case (c1-ai-text-marking.html): a proposal that rewrites
	// all four sentences of one paragraph, reused verbatim from Aldric Vane's fixture data.
	const worstCase: ParagraphSegment[] = [
		{
			text: 'Captain of the Valdoria Watch, forty sworn under him in the Lantern Quarter.',
			proposed: true
		},
		{
			text: 'Iselde Wrenn appointed him after the second freeze, and the harbour has trusted his badge since.',
			proposed: true
		},
		{
			text: 'He drinks at the Gilded Rat most nights, and the watch never bothers him there.',
			proposed: true
		},
		{
			text: "Three hundred and forty sworn take his word over a stranger's.",
			proposed: true
		}
	];

	const mixed: ParagraphSegment[] = [
		{ text: 'Dismissed from the watch in the thaw after the Sable Winter,', proposed: false },
		{ text: 'he now answers to the Ashen Ledger.', proposed: true },
		{ text: 'He still drinks at the Gilded Rat.', proposed: false }
	];
</script>

<svelte:head><title>Component gallery: AI marking (dev only)</title></svelte:head>

<!-- #474: `AppShell` only supplies `<main id="main">` once someone is signed in - see
     `routes/dev/ui/+page.svelte`'s same comment for the full rationale. This gallery
     carries no auth guard, so it still needs exactly one `main` signed out. -->
<svelte:element this={page.data.user ? 'div' : 'main'} class="mx-auto max-w-3xl px-6 py-10">
	<p class="mb-1 font-mono text-xs tracking-wide text-danger uppercase">
		Internal component gallery, not a product page
	</p>
	<h1 class="mb-2 text-2xl font-semibold text-ink">AI text marking</h1>
	<p class="mb-8 max-w-measure text-ink-2">
		Decision C1 = B: unaccepted AI wording gets a dashed underline plus a numbered margin marker, in
		the one hue reserved for the copilot, never hue alone. Proposals do not exist in the database
		yet (<a class="underline" href="https://github.com/fiorelorenzo/canonry/issues/47">#47</a>), so
		this renders <code>AiMarkedParagraph</code> directly against fixture text rather than a real entry.
	</p>

	{#each [{ theme: 'light', label: 'Light palette' }, { theme: 'dark', label: 'Dark palette' }] as pane (pane.theme)}
		<section
			data-theme={pane.theme}
			class="mb-10 rounded-lg border border-line bg-paper p-6 text-ink"
		>
			<h2 class="mb-4 font-mono text-xs tracking-wide text-muted uppercase">{pane.label}</h2>

			<h3 class="mb-2 text-sm font-semibold text-ink">One sentence proposed</h3>
			<div class="mb-6 rounded border border-line bg-panel p-4">
				<AiMarkedParagraph segments={oneSentence} />
			</div>

			<h3 class="mb-2 text-sm font-semibold text-ink">
				Mixed: written and proposed in one paragraph
			</h3>
			<div class="mb-6 rounded border border-line bg-panel p-4">
				<AiMarkedParagraph segments={mixed} />
			</div>

			<h3 class="mb-2 text-sm font-semibold text-ink">
				Worst case: four sentences proposed in one paragraph
			</h3>
			<div class="rounded border border-line bg-panel p-4">
				<AiMarkedParagraph segments={worstCase} />
			</div>
		</section>
	{/each}
</svelte:element>
