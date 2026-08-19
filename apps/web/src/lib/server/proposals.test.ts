/**
 * `enrichCandidate` is pure, so these need no database: they pin down what the review
 * queue is allowed to show for a proposal that creates an entry.
 *
 * The case that produced this file: an import proposes a new entry as kind `create`, which
 * by construction has no `targetEntityId` yet, so `targetEntity` is null and the card fell
 * back to the generic "New entry" label with an empty diff. A GM was being asked to accept
 * a new entry without ever being shown its name or its prose, which is guardrail 3 read the
 * other way round: if a proposal has to show its evidence, it certainly has to show itself.
 */
import { describe, expect, it } from 'vitest';
import type { ProposalRow } from '@canonry/db';
import { enrichCandidate, type ProposalCandidate } from './proposals';

/** Only the columns `enrichCandidate` reads carry meaning here; the rest are filled to
 * satisfy the row type, which is `typeof proposal.$inferSelect`. */
function proposalRow(overrides: Partial<ProposalRow>): ProposalRow {
	return {
		id: '00000000-0000-4000-8000-000000000001',
		universeId: '00000000-0000-4000-8000-0000000000ff',
		planId: null,
		trigger: 'import',
		kind: 'create',
		targetEntityId: null,
		relationTypeId: null,
		relatedEntityId: null,
		patch: {},
		rationale: '',
		locale: null,
		evidence: {},
		rank: 0,
		provider: null,
		modelId: null,
		credits: 0,
		outcome: 'pending',
		rejectReason: null,
		decidedAt: null,
		decidedBy: null,
		appliedRevisionId: null,
		authorKind: 'ai_accepted',
		createdAt: new Date(),
		...overrides
	} as ProposalRow;
}

function candidate(row: ProposalRow): ProposalCandidate {
	return {
		proposal: row,
		targetEntity: null,
		relatedEntity: null,
		relationType: null,
		relationVocab: null,
		filterType: 'place'
	};
}

describe('enrichCandidate, for a proposal that creates an entry', () => {
	it('shows the name and the type the patch declares, since there is no target entity yet', () => {
		const enriched = enrichCandidate(
			candidate(
				proposalRow({
					kind: 'create',
					patch: {
						type: 'place',
						name: 'The Singing Spires of Kelathon',
						slug: 'the-singing-spires-of-kelathon',
						body: 'Seven crystal towers that produce music.'
					}
				})
			)
		);
		expect(enriched.targetName).toBe('The Singing Spires of Kelathon');
		expect(enriched.targetType).toBe('place');
	});

	it("diffs the patch's body, which is the field acceptProposal reads, as all added", () => {
		const enriched = enrichCandidate(
			candidate(
				proposalRow({
					kind: 'create',
					patch: {
						type: 'place',
						name: 'Millbrook',
						slug: 'millbrook',
						body: 'A farming community of twelve hundred souls.'
					}
				})
			)
		);
		expect(enriched.diff.length).toBeGreaterThan(0);
		expect(enriched.diff.every((change) => change.kind === 'added')).toBe(true);
		expect(enriched.diff.map((change) => change.statement).join(' ')).toContain(
			'A farming community of twelve hundred souls.'
		);
	});

	it('does the same for draft_entity, which shares the create patch shape', () => {
		const enriched = enrichCandidate(
			candidate(
				proposalRow({
					kind: 'draft_entity',
					trigger: 'table',
					patch: { type: 'character', name: 'Tobin Sennah', slug: 'tobin-sennah', body: 'A groom.' }
				})
			)
		);
		expect(enriched.targetName).toBe('Tobin Sennah');
		expect(enriched.targetType).toBe('character');
	});

	it('leaves the name null when the patch declares none, rather than inventing one', () => {
		const enriched = enrichCandidate(
			candidate(proposalRow({ kind: 'create', patch: { slug: 'nameless' } }))
		);
		expect(enriched.targetName).toBeNull();
	});
});

describe('enrichCandidate, for a proposal that updates an entry', () => {
	it("still reads the patch's own after text and diffs it against the live body", () => {
		const enriched = enrichCandidate({
			proposal: proposalRow({
				kind: 'update',
				trigger: 'save',
				targetEntityId: '00000000-0000-4000-8000-00000000000a',
				patch: { after: 'He is captain again.' }
			}),
			targetEntity: {
				id: '00000000-0000-4000-8000-00000000000a',
				name: 'Aldric Vane',
				slug: 'aldric-vane',
				type: 'character',
				body: 'He was dismissed from the watch.',
				aliases: []
			},
			relatedEntity: null,
			relationType: null,
			relationVocab: null,
			filterType: 'character'
		});
		expect(enriched.targetName).toBe('Aldric Vane');
		expect(enriched.diff.length).toBeGreaterThan(0);
		expect(enriched.diff.some((change) => change.kind !== 'added')).toBe(true);
	});
});
