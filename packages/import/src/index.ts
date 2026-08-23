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
	profileStep,
	toolSchemaChars,
	type TranscriptSegments,
	type StepProfile,
	type StepSample,
	type StepProfiler
} from './transcript-profile.js';

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

export {
	sniffUpload,
	hasOneNotePdfProducer,
	isUnreadableUploadFormat,
	OFFERED_UPLOAD_EXTENSIONS,
	UNREADABLE_UPLOAD_FORMATS,
	UPLOAD_ACCEPT_ATTRIBUTE,
	WITHHELD_UPLOAD_EXTENSIONS,
	type UploadFormat,
	type UploadSniff,
	type UnreadableUploadFormat
} from './upload-format.js';

export {
	parseMhtml,
	expandOneNoteMhtml,
	splitOneNotePages,
	isOneNoteHtml,
	relativeLocation,
	MhtmlParseError,
	MhtmlTooManyPartsError,
	MhtmlPartTooLargeError,
	MhtmlLocationError,
	type MhtmlLimits,
	type MhtmlPart,
	type ParsedMhtml,
	type OneNotePage,
	type ExpandedEntry,
	type ExpandOneNoteMhtmlOptions
} from './mhtml.js';

export {
	expandOneStore,
	parseOneStore,
	OneStoreParseError,
	OneStoreTooLargeError,
	type OneStoreKind,
	type OneStoreLimits,
	type ExpandOneStoreOptions,
	type ParsedOneStore
} from './onestore.js';

export {
	printedNotebookCoversManySections,
	parseOneNotePrintedFooter,
	type OneNotePrintedFooter
} from './pdf.js';

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
	stripHtmlPresentationNoise,
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
	oneLineSummary,
	nameOverlapScore,
	preFilterCandidates,
	findIdentityCollision,
	EMBEDDING_MATCH_THRESHOLDS,
	MATCH_THRESHOLDS,
	type MatchCandidate,
	type MatchContext,
	type MatchSubject,
	type MatchDecision,
	type MatchThresholds,
	type SimilarityFn,
	type ResolveMatchInput,
	type IdentityCandidate,
	type SubjectIdentity
} from './matching.js';

export {
	bodyWriteVerdict,
	isBareMention,
	pruneForeignAliases,
	updatePatchAddsNothing,
	type BareMentionInput,
	type BodyWriteVerdict
} from './proposal-guards.js';

export {
	runMatchingBenchmark,
	type MatchingPairExample,
	type MatchingCorpus,
	type ThresholdScore,
	type MatchingBenchmarkReport,
	type RunMatchingBenchmarkOptions
} from './matching-benchmark.js';

export { SAMPLE_WORLD_MATCHING_CORPUS } from './matching-benchmark-corpus.js';

export { createLexicalTrigramSimilarity, lexicalTrigramSimilarity } from './lexical-similarity.js';

export {
	createEmbeddingSimilarity,
	cosineSimilarity,
	matchTextFor,
	EmbeddingWidthMismatchError,
	EmbeddingBatchSizeError,
	type EmbedTexts,
	type EmbeddingSimilarityDeps
} from './embedding-similarity.js';

export { bandedSimilarity, type BandedSimilarity } from './similarity.js';

export {
	ImportJobRunner,
	estimateImportJob,
	admitAndCreateImportJob,
	acceptImportProposal,
	acceptAnyImportProposal,
	isRelationTypeProposalKind,
	ImportQuotaExceededError,
	type ImportEstimate,
	type EstimateImportJobInput,
	type AdmitAndCreateImportJobInput,
	type AdmitAndCreateImportJobResult,
	type ImportQuotaRefusalReason,
	type RunImportJobParams,
	type RunImportJobResult,
	type DocumentOutcome,
	type RelationDropLedger,
	type AcceptImportProposalInput
} from './job-runner.js';

export {
	parseOutcomeNote,
	type OutcomeNotePayload,
	type ParsedOutcomeNote,
	type OutcomeNoteOffender,
	type OutcomeNoteOffenderReason,
	type OutcomeNoteLossy
} from './outcome-note.js';

export {
	PLAYBOOK_COLD_START_ESTIMATE,
	UNMEASURED_PLAYBOOK_ESTIMATE,
	HISTORY_EVIDENCE_STATUSES,
	estimateAveragesForPlaybook,
	IMPORT_BUDGET_HEADROOM_MULTIPLIER,
	budgetCreditsForEstimate,
	deriveJobBudget,
	IMPORT_TIMEOUT_HEADROOM_MULTIPLIER,
	IMPORT_TIMEOUT_FLOOR_MS,
	timeoutMsForEstimate,
	type PlaybookAverages,
	type PlaybookEstimateBasis,
	type PlaybookHistoryExclusion,
	type EstimateBasisSink
} from './estimate.js';
