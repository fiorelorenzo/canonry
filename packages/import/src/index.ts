// Public surface of @canonry/import (SPEC.md §11.2, §6). The driver seam, the bounded
// loop's gateway implementation, playbook loading, and the injected filesystem/image
// interfaces - nothing else is exported.

export type {
	ImportDriver,
	ImportJob,
	JobBudget,
	JobDocument,
	JobEvent,
	JobStream,
	DocumentStatus,
	EntityProposalPayload,
	RelationProposalPayload
} from './driver.js';

export {
	GatewayDriver,
	type GatewayWrapper,
	type ImportModel,
	type ModelSelector,
	type BudgetTracker
} from './gateway-driver.js';

export {
	loadPlaybook,
	loadPlaybookFile,
	loadBuiltinPlaybook,
	playbookVersion,
	PlaybookParseError,
	PlaybookValidationError,
	type LoadedPlaybook,
	type LoadPlaybookOptions,
	type ImportModelPurpose
} from './playbook.js';

export { IMPORT_TOOL_NAMES, isImportToolName, type ImportToolName } from './tool-names.js';

export {
	createImportTools,
	createDocumentRunContext,
	type DocumentRunContext,
	type CreateImportToolsDeps
} from './tools.js';

export {
	InMemorySourceReader,
	SourceNotFoundError,
	type SourceReader,
	type SourceEntry,
	type SourceReadResult,
	type RenderedPage,
	type BinaryAsset
} from './sources.js';

export { InMemoryImageStore, type ImageStore, type StoredImage } from './images.js';

export {
	createLoopLogger,
	loopLogger,
	ForbiddenLoopLogFieldError,
	type LoopLogger,
	type LoopLogFields,
	type LoopLogEvent,
	type LoopLogStatus,
	type LoopLogSink
} from './logging.js';

export {
	ArchiveSourceReader,
	DEFAULT_ARCHIVE_LIMITS,
	ArchiveTooLargeError,
	TooManyEntriesError,
	PathTraversalError,
	ZipBombError,
	UnsupportedCompressionError,
	ArchiveParseError,
	ArchiveEntryExtractionError,
	type ArchiveLimits
} from './archive.js';

export {
	DbModelSelector,
	type PurposeResolution,
	type ResolvePurpose,
	type LanguageModelFactory,
	type DbModelSelectorDeps
} from './model-selector.js';

export {
	resolveMatch,
	normalizeForMatching,
	nameOverlapScore,
	preFilterCandidates,
	type MatchCandidate,
	type MatchSubject,
	type MatchDecision,
	type MatchThresholds,
	type SimilarityFn,
	type ResolveMatchInput
} from './matching.js';

export {
	runMatchingBenchmark,
	type MatchingPairExample,
	type MatchingCorpus,
	type ThresholdScore,
	type MatchingBenchmarkReport,
	type RunMatchingBenchmarkOptions
} from './matching-benchmark.js';

export { SAMPLE_WORLD_MATCHING_CORPUS } from './matching-benchmark-corpus.js';

export { lexicalTrigramSimilarity } from './lexical-similarity.js';

export {
	ImportJobRunner,
	estimateImportJob,
	admitAndCreateImportJob,
	acceptImportProposal,
	ImportQuotaExceededError,
	type ImportEstimate,
	type EstimateImportJobInput,
	type AdmitAndCreateImportJobInput,
	type AdmitAndCreateImportJobResult,
	type ImportQuotaRefusalReason,
	type RunImportJobParams,
	type RunImportJobResult,
	type DocumentOutcome,
	type AcceptImportProposalInput
} from './job-runner.js';
