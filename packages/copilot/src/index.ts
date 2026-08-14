// Public surface of @canonry/copilot: propagation end to end (SPEC.md §5.1, issues #47-52
// and #56). Nothing outside this list should be imported from a sibling package's src/.

export { semanticDiff, splitIntoSentences, type FactChange, type FactChangeKind } from './diff.js';

export {
	buildCandidatePool,
	type BuildCandidatePoolOptions,
	type CandidateEntry,
	type CandidateEvidence,
	type CandidateGraph,
	type EmbeddingEvidence,
	type EmbeddingMatch,
	type GraphEntity,
	type GraphRelationEdge,
	type MentionEvidence,
	type RelationEvidence
} from './candidates.js';

export { loadCandidateGraph } from './db-graph.js';

export {
	effectiveCap,
	normalizeReason,
	rejectPenaltyFor,
	scoreCandidates,
	type ReasonChip,
	type RejectionRecord,
	type ScoredCandidate
} from './reject-signal.js';

export {
	routeModel,
	type GatewayWrapper,
	type ModelFactory,
	type ModelParams,
	type ModelPurpose,
	type ResolvedModel,
	type RoutedModel
} from './models.js';

export {
	writePlanRationale,
	type PlanCandidateInput,
	type PlanRationale,
	type RankedCandidate,
	type WritePlanRationaleInput
} from './ranking.js';

export {
	writeEntityDiff,
	type EntityUpdatePatch,
	type WriteEntityDiffInput,
	type WrittenDiff
} from './diffs.js';

export {
	planPropagation,
	generatePlanDiffs,
	AiDisabledError,
	type GeneratePlanDiffsInput,
	type GeneratePlanDiffsResult,
	type PlanPropagationInput,
	type PlanPropagationResult
} from './propagate.js';

export { realCandidateSelector } from './eval-adapter.js';
