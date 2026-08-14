/**
 * Wraps the real candidate-pool builder (candidates.ts) as `@canonry/eval`'s
 * `CandidateSelector` (issue #99), so `runPropagationEval` in eval.test.ts scores the
 * actual algorithm rather than a stand-in - the whole reason that harness takes an
 * injected selector instead of hardcoding one.
 *
 * This measures the deterministic retrieval layer of issue #49 specifically: graph 2-hop
 * plus mention retrieval. No embeddings (the corpus carries no vectors to search) and no
 * cheap-model pruning - issue #52's ranking call (ranking.ts) writes the plan's
 * human-readable rationale over whatever order this produces, it does not decide which
 * candidates survive (see ranking.ts's doc comment for why that split is deliberate).
 * Reject history is always empty here: the corpus has no proposal history to draw from,
 * and issue #56's scorer already has its own direct unit tests in reject-signal.test.ts.
 */
import type {
	CandidateSelector,
	CandidateSelectorContext,
	EntitySlug,
	PropagationWorld
} from '@canonry/eval';
import { buildCandidatePool, type CandidateGraph } from './candidates.js';
import { semanticDiff } from './diff.js';
import { scoreCandidates } from './reject-signal.js';

function toGraph(world: PropagationWorld): CandidateGraph {
	return {
		entities: world.entities.map((entity) => ({
			id: entity.slug,
			type: entity.type,
			name: entity.name,
			aliases: entity.aliases ?? [],
			body: entity.body
		})),
		relations: world.relations.map((relation) => ({
			fromId: relation.from,
			toId: relation.to,
			label: relation.label
		}))
	};
}

export function realCandidateSelector(): CandidateSelector {
	return (ctx: CandidateSelectorContext): EntitySlug[] => {
		const graph = toGraph(ctx.world);
		const before = ctx.world.entities.find(
			(entity) => entity.slug === ctx.propagationCase.editedEntitySlug
		);
		if (!before) {
			throw new Error(
				`realCandidateSelector: unknown edited entity "${ctx.propagationCase.editedEntitySlug}"`
			);
		}
		const diff = semanticDiff(before.body, ctx.propagationCase.editedBody);
		const pool = buildCandidatePool(graph, ctx.propagationCase.editedEntitySlug, diff);
		return scoreCandidates(pool, []).map((candidate) => candidate.entityId);
	};
}
