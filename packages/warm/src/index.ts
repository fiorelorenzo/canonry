// Public surface of @canonry/warm (SPEC.md §4.5, §8, §8.1). The fingerprint/store/budget
// policy layer around @canonry/db's warm_artifact and session_context queries - nothing
// else is exported.

export { computeFingerprint, type FingerprintInput } from './fingerprint.js';

export { assertWarmable, NotWarmableError } from './kinds.js';

export {
	warmTierOf,
	sortByDegradationOrder,
	createInMemoryWarmBudgetPort,
	type WarmTier,
	type WarmBudgetPort
} from './budget.js';

export { createDbWarmBudgetPort } from './budget-live.js';

export {
	checkFreshness,
	regenerate,
	consumeArtifact,
	type WarmCandidate,
	type DraftEntityPayload,
	type WarmGenerationResult,
	type WarmGenerator,
	type FreshnessResult,
	type RegenerateStatus,
	type RegenerateResult,
	type ProposalRow
} from './store.js';

export { declareContextAndPin, type DeclareContextResult } from './context.js';

export {
	WriteDebounce,
	warmOnWrite,
	warmOnPrep,
	warmOnTableOpen,
	warmOnConsumption,
	warmNightly,
	AiDisabledError,
	type WriteDebounceOptions,
	type WriteWarmInput,
	type PrepWarmInput,
	type TableOpenWarmInput,
	type ConsumptionWarmInput,
	type NightlyWarmInput
} from './triggers.js';

export {
	warmRadiusFor,
	currentWarmRadius,
	WARM_RADIUS_HIT_RATE_THRESHOLD,
	type WarmRadius,
	type WarmRadiusDecision
} from './radius.js';
