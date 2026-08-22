// Public surface of @canonry/copilot: propagation end to end (SPEC.md §5.1, issues #47-52
// and #56). Nothing outside this list should be imported from a sibling package's src/.

export {
	semanticDiff,
	splitIntoSentences,
	fenceSafeSentences,
	tokenize,
	jaccard,
	type FactChange,
	type FactChangeKind
} from './diff.js';

export {
	buildCandidatePool,
	graphNeighbors,
	namesFor,
	mentionsIn,
	type BuildCandidatePoolOptions,
	type CandidateEntry,
	type CandidateEvidence,
	type CandidateGraph,
	type EmbeddingEvidence,
	type EmbeddingMatch,
	type GraphEntity,
	type GraphRelationEdge,
	type MentionEvidence,
	type MentionHit,
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
	requireAiEnabled,
	type GeneratePlanDiffsInput,
	type GeneratePlanDiffsResult,
	type PlanPropagationInput,
	type PlanPropagationResult
} from './propagate.js';

export { realCandidateSelector } from './eval-adapter.js';

export {
	runAudit,
	AUDIT_PAIR_CAP,
	findCandidatePairs,
	isGuardrailSafeTopic,
	buildFlagRationale,
	judgeStatementPair,
	type JudgeStatementPairInput,
	type StatementPairJudgment,
	type AuditFlagStatement,
	type RunAuditInput,
	type RunAuditResult,
	type WrittenAuditFlag
} from './audit.js';

export {
	runAsk,
	clampAskHistory,
	MAX_HISTORY_TURNS,
	MAX_HISTORY_TURN_CHARS,
	type AskContext,
	type AskDetailLevel,
	type AskHistoryTurn,
	type AskInput,
	type AskProposalEvent,
	type AskResult,
	type AskSource,
	type IndexedSource,
	type OwnCanonSource,
	type QueryEmbedder
} from './ask.js';

export {
	entryEditPropose,
	entryPropose,
	type AskEvidence,
	type EntryEditProposeInput,
	type EntryProposeInput,
	type EvidenceSource,
	type InstructionEvidence,
	type ProposeResult
} from './ask-propose.js';

export { completeEntry, type CompleteEntryInput, type CompleteEntryResult } from './complete.js';

export {
	resolveRelationType,
	isInverseMatch,
	normalizeRelationLabel,
	type RelationTypeResolution,
	type ResolveRelationTypeDeps,
	type ResolveRelationTypeInput,
	type Embedder
} from './relation-types.js';

// The shipped relation catalogue's per-locale strings are not re-exported from here on
// purpose: they live in `@canonry/lang`, which has no dependencies, and `apps/web`'s i18n
// bundle imports them directly. Re-exporting them through this barrel is what dragged this
// package's server graph into the client bundle once already (#197), so anything that needs
// them, including this package, imports `@canonry/lang`.

// issue #263: packages/import's job-runner.ts is outside this package, so its rationale
// strings have to come through the barrel like everything else here does - see
// speech.ts's own doc comment on this export for why they are not model output.
export {
	IMPORT_RATIONALE_EXTRACTED,
	IMPORT_RATIONALE_AMBIGUOUS,
	IMPORT_RATIONALE_MATCHED,
	IMPORT_RATIONALE_RELATION
} from './speech.js';
