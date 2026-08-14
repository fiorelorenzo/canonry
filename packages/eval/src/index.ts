export type {
	CandidateSelector,
	CandidateSelectorContext,
	EntitySlug,
	PropagationCase,
	PropagationCaseScore,
	PropagationEntity,
	PropagationEntityType,
	PropagationEvalOptions,
	PropagationRelation,
	PropagationReport,
	PropagationWorld
} from './propagation/types.js';
export { runPropagationEval } from './propagation/runner.js';
export type {
	AcceptRateResult,
	ProposalOutcome,
	ProposalOutcomeRecord
} from './propagation/accept-rate.js';
export { acceptRate, acceptRateByGroup } from './propagation/accept-rate.js';
export {
	propagationWorlds,
	valdoriaReach,
	brackwaterMire,
	thornwickCollege
} from './propagation/corpus/index.js';

export type {
	GoldChunk,
	GoldQuestion,
	RetrievalCorpus,
	RetrievalEvalOptions,
	RetrievalHit,
	RetrievalQuestionScore,
	RetrievalReport,
	Retriever,
	ThresholdEffect
} from './retrieval/types.js';
export { runRetrievalEval } from './retrieval/runner.js';
export { retrievalCorpora, valdoriaReachRetrieval } from './retrieval/corpus/index.js';
