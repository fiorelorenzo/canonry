<script lang="ts">
	/**
	 * #106, and round seventeen's V6 (#499): a component gallery for the two signals this
	 * product must never let a reader confuse - C1's mark ("this wording is AI's, and
	 * nobody has accepted it yet") and V6's change bar ("this is the GM's own accepted
	 * canon, and a proposal is waiting to touch it"). They render one above the other in
	 * both palettes so the difference is never a guess: same paper, same hue
	 * (`--color-diff-line`), and still two different claims. Proposals do not exist in the
	 * database as fixtures (#47), so this renders each component directly against fixture
	 * text rather than faking a proposal row into a real entry.
	 */
	import { page } from '$app/state';
	import { PageHeader, PageBody } from '$lib/components/ui/page-header';
	import AiMarkedParagraph from '$lib/components/ai/AiMarkedParagraph.svelte';
	import type { ParagraphSegment } from '$lib/components/ai/aiMarking';
	import { renderMarkdown, type MentionTarget } from '$lib/markdown';
	import {
		splitBodyIntoBlocks,
		markedProposalFor,
		renderChangeBar,
		type MarkedProposalRef
	} from '$lib/components/ai/entryMarking';

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

	// V6 = A (#499): the change bar's own fixture, built through the exact pipeline
	// `EntryProseWithSecrets.svelte` runs for a real entry - `splitBodyIntoBlocks`,
	// `markedProposalFor`, the normal `renderMarkdown`, then `renderChangeBar` - so this
	// gallery can never drift from what the entry page actually renders. Two paragraphs:
	// the first has nothing pending and renders exactly as typed; the second has a pending
	// proposal and carries the bar, with its own `[[mention]]` resolved to a real link -
	// the fix for the second cost V6 named, where the old marking stripped every mention
	// to a bare name.
	const changeBarMentionTargets: MentionTarget[] = [
		{ name: 'The Ashen Ledger', slug: 'the-ashen-ledger', aliases: [] }
	];
	const changeBarBody =
		'Captain of the Valdoria Watch, forty sworn under him in the Lantern Quarter.\n\nHe now answers to [[The Ashen Ledger]], and the harbour still calls him captain out of habit.';
	const changeBarTarget = new Map<string, MarkedProposalRef>([
		[
			'He now answers to [[The Ashen Ledger]], and the harbour still calls him captain out of habit.',
			{ proposalId: 'demo-proposal', planId: null }
		]
	]);
	const changeBarHtml = splitBodyIntoBlocks(changeBarBody)
		.map((block) => {
			const rendered = renderMarkdown(block.raw, 'valdoria-reach', changeBarMentionTargets, 'gm');
			const proposal = markedProposalFor(block, changeBarTarget);
			return proposal
				? renderChangeBar(
						rendered,
						'/w/valdoria-reach/proposals',
						'A proposal is waiting on this passage. Open it to review.'
					)
				: rendered;
		})
		.join('\n');
</script>

<svelte:head><title>Component gallery: AI marking and the change bar (dev only)</title></svelte:head
>

<svelte:element this={page.data.user ? 'div' : 'main'}>
	<PageHeader
		eyebrow="Internal component gallery, not a product page"
		title="AI marking and the change bar"
	/>
	<PageBody width="working">
		<p class="mb-2 max-w-measure text-ink-2">
			Two signals, never the same claim. <strong class="text-ink">C1's mark</strong> - a dashed underline
			plus a numbered margin marker, in the one hue reserved for the copilot - says "this wording is the
			AI's, and nobody has accepted it yet." It only ever appears on a diff or on a drafted proposal still
			in the copilot's own dock, never on the entry's own prose.
		</p>
		<p class="mb-8 max-w-measure text-ink-2">
			<strong class="text-ink">V6's change bar</strong> (round seventeen,
			<a class="underline" href="https://github.com/fiorelorenzo/canonry/issues/499">#499</a>) says
			the opposite kind of thing: "this is the GM's own accepted canon, and a proposal is waiting to
			change it." No claim about who wrote it, and the proposed wording itself stays off this page
			entirely - it lives in the diff, which keeps C1's mark. Proposals do not exist in the database
			as fixtures (<a class="underline" href="https://github.com/fiorelorenzo/canonry/issues/47"
				>#47</a
			>), so both signals below render straight from fixture text.
		</p>

		{#each [{ theme: 'light', label: 'Light palette' }, { theme: 'dark', label: 'Dark palette' }] as pane (pane.theme)}
			<section
				data-theme={pane.theme}
				class="mb-10 rounded-lg border border-line bg-paper p-6 text-ink"
			>
				<h2 class="mb-4 font-mono text-xs tracking-wide text-muted uppercase">{pane.label}</h2>

				<h3 class="mb-1 text-sm font-semibold text-ink">
					C1's mark - AI wording nobody has accepted
				</h3>
				<p class="mb-3 text-xs text-muted">
					The diff, and the dock's drafted proposals. Never the entry's own prose.
				</p>

				<h4 class="mb-2 text-xs font-semibold text-ink-2 uppercase">One sentence proposed</h4>
				<div class="mb-6 rounded border border-line bg-panel p-4">
					<AiMarkedParagraph segments={oneSentence} />
				</div>

				<h4 class="mb-2 text-xs font-semibold text-ink-2 uppercase">
					Mixed: written and proposed in one paragraph
				</h4>
				<div class="mb-6 rounded border border-line bg-panel p-4">
					<AiMarkedParagraph segments={mixed} />
				</div>

				<h4 class="mb-2 text-xs font-semibold text-ink-2 uppercase">
					Worst case: four sentences proposed in one paragraph
				</h4>
				<div class="mb-8 rounded border border-line bg-panel p-4">
					<AiMarkedParagraph segments={worstCase} />
				</div>

				<h3 class="mb-1 text-sm font-semibold text-ink">
					V6's change bar - the GM's own canon, with something waiting
				</h3>
				<p class="mb-3 text-xs text-muted">
					The entry's own read view. The prose is untouched, mentions and all - only the margin
					gains a bar, and only beside the paragraph a pending proposal targets.
				</p>
				<div class="entry-prose-secrets-demo rounded border border-line bg-panel p-4 text-sm">
					<!-- Fixture markup built from this page's own trusted strings through
				     renderMarkdown/renderChangeBar, the same pure functions the entry page renders
				     with, never from user input. -->
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					{@html changeBarHtml}
				</div>
			</section>
		{/each}
	</PageBody>
</svelte:element>

<style>
	/* Duplicated from `EntryProseWithSecrets.svelte`'s own `<style>` block rather than
	   shared, for the same reason that file duplicates `AiMarkedParagraph`'s C1 rules:
	   `{@html}` content never carries this component's scoping class, so a scoped
	   selector without `:global()` would silently match nothing. */
	.entry-prose-secrets-demo :global(p) {
		margin: 0 0 0.75rem;
		line-height: 1.6;
	}
	.entry-prose-secrets-demo :global(p:last-child) {
		margin-bottom: 0;
	}
	.entry-prose-secrets-demo :global(a.mention) {
		color: var(--color-accent-ink);
		border-bottom: 1px solid var(--color-line-2);
		text-decoration: none;
	}
	.entry-prose-secrets-demo :global(.ai-change-bar-block) {
		position: relative;
		padding-left: 1rem;
	}
	.entry-prose-secrets-demo :global(.ai-change-bar) {
		position: absolute;
		inset: 0 auto 0 0;
		width: 1rem;
		display: block;
		border-radius: 2px;
	}
	.entry-prose-secrets-demo :global(.ai-change-bar::before) {
		content: '';
		position: absolute;
		left: 0.35rem;
		top: 0;
		bottom: 0;
		width: 3px;
		border-radius: 2px;
		background: var(--color-diff-line);
	}
	.entry-prose-secrets-demo :global(.ai-change-bar:hover::before) {
		width: 4px;
	}
	.entry-prose-secrets-demo :global(.ai-change-bar:focus-visible) {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}
</style>
