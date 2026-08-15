/**
 * C5 = B (docs/ux/DECISIONS.md): evidence normalised into one small display shape,
 * regardless of which producer wrote it - `packages/copilot`'s `CandidateEvidence[]` for a
 * propagation candidate, or `packages/import`'s ad hoc match-evidence object for an import
 * candidate. Guardrail 3's "never a bare confidence score" is enforced here: nothing below
 * ever surfaces a raw number on its own, only a plain-word reason a quote can sit beside.
 *
 * The forced-open rule is the one guardrail-load-bearing piece: a candidate whose only
 * channel is embedding similarity - no relation, no textual mention - is exactly the
 * "reached only by embedding similarity" case guardrail 3 exists for, and its evidence
 * renders open by default rather than behind a click (`EvidencePopover`'s `forceOpen`).
 */

export type EvidenceReason =
	| { kind: 'relation'; path: string[]; hops: number }
	| { kind: 'mention'; direction: 'forward' | 'reverse'; matchedText: string }
	| { kind: 'embedding' }
	| { kind: 'importAmbiguous'; path: string | null; count: number }
	| { kind: 'importMatched'; path: string | null }
	| { kind: 'importExtracted'; path: string | null };

export interface EvidenceView {
	/** The source sentence, when the producer captured one. Import's match evidence only
	 * carries offsets into a document this app cannot re-read (packages/import's own
	 * provider boundary - see job-runner.ts), so an import candidate's view has no quote,
	 * only its rationale and source path, which is what is actually known. */
	quote: string | null;
	/** Structured, never a pre-formatted sentence: this module carries no English words,
	 * so a locale only has to format a known shape, never re-parse a sentence to
	 * translate it (issue #121 - see `EvidencePopover.svelte`'s formatting switch). */
	reason: EvidenceReason;
}

interface RelationEvidenceShape {
	kind: 'relation';
	hops: number;
	path: string[];
}

interface MentionEvidenceShape {
	kind: 'mention';
	direction: 'forward' | 'reverse';
	matchedText: string;
	sourceSentence: string;
}

interface EmbeddingEvidenceShape {
	kind: 'embedding';
	similarity: number;
	sourceSentence: string;
}

type CandidateEvidenceShape = RelationEvidenceShape | MentionEvidenceShape | EmbeddingEvidenceShape;

function isCandidateEvidence(value: unknown): value is CandidateEvidenceShape {
	if (typeof value !== 'object' || value === null || !('kind' in value)) return false;
	return value.kind === 'relation' || value.kind === 'mention' || value.kind === 'embedding';
}

function viewForCandidateEvidence(evidence: CandidateEvidenceShape): EvidenceView {
	switch (evidence.kind) {
		case 'relation':
			return {
				quote: null,
				reason: { kind: 'relation', path: evidence.path, hops: evidence.hops }
			};
		case 'mention':
			return {
				quote: evidence.sourceSentence,
				reason: {
					kind: 'mention',
					direction: evidence.direction,
					matchedText: evidence.matchedText
				}
			};
		case 'embedding':
			return { quote: evidence.sourceSentence, reason: { kind: 'embedding' } };
	}
}

interface ImportEvidenceShape {
	documentId?: unknown;
	sourceRef?: { path?: unknown };
	similarity?: unknown;
	ambiguousCandidateIds?: unknown;
}

function isImportEvidence(value: unknown): value is ImportEvidenceShape {
	return typeof value === 'object' && value !== null && 'sourceRef' in value;
}

/** Every propagation `CandidateEvidence` kind is "relation" or "mention" except pure
 * embedding matches, so an import candidate (extraction, not a graph the model walked)
 * counts as embedding-strength evidence only when the match itself was uncertain (an
 * `ask` decision, carrying a similarity score) - an exact or confident match has a real
 * channel (the source document itself matched by content), not a stretch. */
function viewForImportEvidence(evidence: ImportEvidenceShape): {
	view: EvidenceView;
	weak: boolean;
} {
	const path = typeof evidence.sourceRef?.path === 'string' ? evidence.sourceRef.path : null;
	const ambiguousCount = Array.isArray(evidence.ambiguousCandidateIds)
		? evidence.ambiguousCandidateIds.length
		: 0;
	if (typeof evidence.similarity === 'number' && ambiguousCount > 0) {
		return {
			view: { quote: null, reason: { kind: 'importAmbiguous', path, count: ambiguousCount } },
			weak: true
		};
	}
	if (typeof evidence.similarity === 'number') {
		return { view: { quote: null, reason: { kind: 'importMatched', path } }, weak: true };
	}
	return { view: { quote: null, reason: { kind: 'importExtracted', path } }, weak: false };
}

export interface NormalizedEvidence {
	views: EvidenceView[];
	/** C5's rule: forced open only when nothing but embedding-strength evidence backs this
	 * candidate. */
	forceOpen: boolean;
}

export function normalizeEvidence(trigger: string, evidence: unknown): NormalizedEvidence {
	if (trigger === 'import') {
		if (!isImportEvidence(evidence)) return { views: [], forceOpen: false };
		const { view, weak } = viewForImportEvidence(evidence);
		return { views: [view], forceOpen: weak };
	}

	if (!Array.isArray(evidence)) return { views: [], forceOpen: false };
	const items = evidence.filter(isCandidateEvidence);
	if (items.length === 0) return { views: [], forceOpen: false };

	const views = items.map(viewForCandidateEvidence);
	const forceOpen = items.every((item) => item.kind === 'embedding');
	return { views, forceOpen };
}
