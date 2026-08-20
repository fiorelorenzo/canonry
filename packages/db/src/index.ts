export { closeDb, createDb, ping, type Db } from './client.js';
export { runMigrations } from './migrate.js';
export { factWithSource, type FactWithSource } from './queries/facts.js';
export { relationsFor, type RelationView } from './queries/relations.js';
export {
	relationTypesForUniverse,
	listRelationTypesForUniverse,
	renameRelationType,
	widenRelationType,
	mergeRelationTypes,
	setRelationTypeLabel,
	clearRelationTypeLabel,
	RelationTypeNotOwnedError,
	RelationTypeLabelConflictError,
	type RelationTypeRow,
	type RelationTypeCatalogueRow,
	type RelationTypeLabelRow,
	type RenameRelationTypeInput,
	type WidenRelationTypeInput,
	type MergeRelationTypesInput,
	type MergeRelationTypesResult,
	type SetRelationTypeLabelInput
} from './queries/relation-types.js';
export { historyFor } from './queries/revisions.js';
export {
	recentActivity,
	weeklyChangeCounts,
	type ActivityItem,
	type RevisionActivity,
	type RelationActivity,
	type WorkActivity,
	type WeeklyChangeCount
} from './queries/activity.js';
export {
	nextEntityLanguage,
	saveEntityBody,
	setEntityLanguage,
	resetEntityLanguageToDetected,
	languageFromAcceptedPatch,
	createEntity,
	listEntitiesForUniverse,
	entityCountsByType,
	entityBrowserPage,
	setEntityCover,
	type EntityLanguageState,
	type StoredEntityLanguage,
	type SaveEntityBodyInput,
	type SaveEntityBodyResult,
	type EntityRow,
	type CreateEntityInput,
	type EntityBrowserRow,
	type ListEntitiesOptions,
	type EntityBrowserSort,
	type EntityBrowserPage,
	type EntityBrowserPageOptions,
	type EntityBrowserPageRow
} from './queries/entities.js';
export {
	universeForExport,
	streamEntitiesForExport,
	countEntitiesForExport,
	type UniverseExportMeta,
	type ExportEntityRow
} from './queries/export.js';
export {
	priceOf,
	setPrice,
	listPrices,
	OperationNotPricedError,
	type PriceRow,
	type SetPriceInput
} from './queries/prices.js';
export {
	createProposalPlan,
	dropCandidateFromPlan,
	recordProposalDiff,
	setProposalPlanStatus,
	listProposalsForPlan,
	getProposalPlan,
	getProposal,
	rejectedProposalsFor,
	acceptProposal,
	rejectProposal,
	setRejectReason,
	undoAcceptedProposal,
	entityDeletedByUndo,
	readEntityCreatePatch,
	ProposalNotFoundError,
	ProposalPlanNotFoundError,
	ProposalAlreadyDecidedError,
	ProposalHasDiffError,
	ProposalCannotBeAcceptedError,
	ProposalNotAcceptedError,
	UndoNotPossibleError,
	EntitySlugCollisionUnresolvedError,
	RelationTypeNotAdmittedError,
	type ProposalRow,
	type ProposalPlanRow,
	type CreateProposalPlanCandidate,
	type CreateProposalPlanInput,
	type CreateProposalPlanResult,
	type DropCandidateResult,
	type RecordProposalDiffInput,
	type RejectedProposalRecord,
	type AcceptProposalInput,
	type RejectProposalInput,
	type UndoAcceptedProposalInput,
	type EntityCreatePatchShape
} from './queries/proposals.js';
export {
	FREE_PLAN_SUBSCRIPTION_CREDITS,
	FREE_PLAN_WARM_BUDGET_CREDITS,
	ensureBilling,
	getBalance,
	previewCharge,
	recordAndCharge,
	spendCredits,
	spendWarmBudget,
	toBalance,
	listByoKeys,
	upsertByoKey,
	activeByoKeySecret,
	touchByoKeyUsage,
	setByoKeyActive,
	deleteByoKey,
	InsufficientCreditsError,
	WarmBudgetExhaustedError,
	type Balance,
	type ByoKeyRow,
	type ChargeInput,
	type ChargeResult,
	type SpendCreditsInput,
	type SpendCreditsResult,
	type WarmSpendInput
} from './queries/billing.js';
export {
	SUBSCRIPTION_PLANS,
	getSubscriptionPlan,
	applySubscriptionWebhookEvent,
	UnknownSubscriptionPlanError,
	type SubscriptionPlan,
	type SubscriptionWebhookEvent,
	type ApplyWebhookEventResult
} from './queries/subscriptions.js';
export {
	universeAccessBySlug,
	universesForUser,
	entityCountsByUniverseIds,
	propagationCapForUniverse,
	type UniverseAccess
} from './queries/access.js';
export { accountDeletionImpact, type AccountDeletionImpact } from './queries/account.js';
export {
	latestRevisionIds,
	findByFingerprint,
	latestArtifact,
	putArtifact,
	markStale,
	recordConsumption,
	staleArtifacts,
	declareSessionContext,
	runningSessionContext,
	endSessionContext,
	pinnedNeighbors,
	activeUniverseIds,
	type WarmArtifactRow,
	type SessionContextRow,
	type DeclareSessionContextInput,
	type PinnedNeighbor
} from './queries/warm.js';
export {
	revealEntityLive,
	revealFactLive,
	revealRelationLive,
	queueEntityForSessionLog,
	queueFactForSessionLog,
	queueRelationForSessionLog,
	confirmSessionLog,
	publicMentionTargets,
	isPubliclyVisible,
	listPublicEntities,
	publicEntityBySlug,
	publicMediaAssetById,
	revelationLogForUniverse,
	type RevelationRow,
	type RevelationLogEntry,
	type RevealEntityInput,
	type RevealFactInput,
	type RevealRelationInput,
	type PublicMentionTarget,
	type RevealedEntityListItem,
	type PublicGapEntity,
	type PublicFullEntity,
	type PublicFactRow,
	type PublicRelationRow,
	type PublicImageRow,
	type PublicEntity,
	type PublicMediaAssetRow
} from './queries/players.js';
export {
	getDataSource,
	listDataSourcesForUniverse,
	createDataSource,
	recordLicenceReview,
	requireIndexableDataSource,
	markIndexingStarted,
	markIndexed,
	markIndexingFailed,
	listExclusionPatterns,
	listExclusionPatternsForUniverse,
	addExclusion,
	ownCanonDataSource,
	DataSourceNotFoundError,
	LicenceNotReviewedError,
	DataSourceExcludedError,
	type DataSourceRow,
	type CreateDataSourceInput,
	type RecordLicenceReviewInput,
	type MarkIndexedInput,
	type AddExclusionInput,
	type DataSourceExclusionRow
} from './queries/sources.js';
export {
	activeImageModelRow,
	listImageModels,
	upsertImageModel,
	entryStyleContext,
	mediaAssetsForEntity,
	createMediaAsset,
	attachMediaAsset,
	mediaAssetById,
	mediaAssetsByIds,
	setMediaAssetPublished,
	type ImageModelRow,
	type UpsertImageModelInput,
	type EntryStyleContext,
	type MediaAssetRow,
	type CreateMediaAssetInput
} from './queries/media.js';
export {
	listActiveTextModels,
	upsertTextModel,
	type ModelConfigRow,
	type UpsertTextModelInput
} from './queries/models.js';
export {
	createImportJob,
	getImportJob,
	importJobsForUniverse,
	countRunningImportJobs,
	queuePositionFor,
	admitImportJob,
	updateImportJobCheckpoint,
	settleImportJob,
	importUsageForUser,
	importQuotaForUser,
	checkImportQuota,
	findEntityBySourceRef,
	candidateEntitiesForMatching,
	pendingEntityProposalsForJob,
	foldEntitySightingIntoPendingProposal,
	recordEntitySourceRef,
	syncMissingEntitySourceRefs,
	missingEntitySourceRefsForJob,
	acceptImportProposal,
	acceptAnyImportProposal,
	acceptRelationTypeProposal,
	isRelationTypeProposalKind,
	pendingRelationTypeProposalForJob,
	foldRelationIntoPendingRelationTypeProposal,
	proposeRelationTypeVocabulary,
	ImportJobNotFoundError,
	type ImportJobRow,
	type EntitySourceRefRow,
	type CreateImportJobInput,
	type AdmitResult,
	type CheckpointUpdate,
	type SettleImportJobInput,
	type SettleResult,
	type ImportUsage,
	type ImportQuota,
	type ImportQuotaCheckInput,
	type ImportQuotaCheckResult,
	type EntitySourceRefMatch,
	type MatchCandidateRow,
	type FoldEntitySightingInput,
	type RecordEntitySourceRefInput,
	type AcceptImportProposalInput,
	type SyncMissingEntitySourceRefsInput,
	type SyncMissingEntitySourceRefsResult,
	type MissingEntitySourceRefRow,
	type RelationTypeWaitingRelation,
	type RelationTypeVocabResolutionInput,
	type RelationTypeVocabPatch,
	type PendingRelationTypeProposalMatch,
	type ProposeRelationTypeVocabularyInput,
	type ProposeRelationTypeVocabularyResult,
	type AcceptRelationTypeProposalInput,
	type AcceptRelationTypeProposalResult
} from './queries/import.js';
export {
	proposalOutcomesForMetrics,
	importsToFirstAcceptedProposal,
	warmHitRate,
	sessionEntropyMetrics,
	auditFlagOutcomes,
	ACCEPT_RATE_DEFAULT_WINDOW_DAYS,
	DEBRIEF_WINDOW_HOURS,
	type ProposalOutcomeMetricRow,
	type ImportFirstAcceptRow,
	type WarmHitRateRow,
	type SessionEntropyRow,
	type AuditFlagOutcomeRow
} from './queries/metrics.js';
export {
	listWorksForUniverse,
	createWork,
	workBySlug,
	workById,
	workNodeTree,
	createWorkNode,
	workNodeById,
	ancestorsOf,
	updateWorkNode,
	setWorkNodeEntities,
	usesForNode,
	scenesUsingEntity,
	moveWorkNode,
	type WorkRow,
	type WorkNodeRow,
	type WorkNodeTreeItem,
	type CreateWorkInput,
	type CreateWorkNodeInput,
	type UpdateWorkNodeInput,
	type WorkNodeUse,
	type SceneUsingEntity,
	type MoveWorkNodeDirection,
	type MoveWorkNodeResult
} from './queries/works.js';
export {
	listSupersedesForUniverse,
	supersededUrlsForUniverse,
	createSupersede,
	removeSupersede,
	SupersedeAlreadyExistsError,
	type SupersedeRow,
	type CreateSupersedeInput
} from './queries/supersede.js';
export {
	searchEntitiesByNameOrAlias,
	type EntitySearchHit,
	type SearchEntitiesOptions
} from './queries/table-search.js';
export {
	keepAnswer,
	listKeptAnswers,
	keptAnswerById,
	deleteKeptAnswer,
	KeptAnswerSourceInvalidError,
	type KeptAnswerRow,
	type KeepAnswerInput,
	type KeepAnswerSourceInput,
	type KeptAnswerRecord,
	type KeptAnswerSourceRecord,
	type ListKeptAnswersInput,
	type KeptAnswerRefInput
} from './queries/kept-answers.js';

/**
 * The query operators, re-exported from the one drizzle this workspace installs.
 * Consumers need `eq` and friends the moment they write anything, and the alternative
 * is every app declaring `drizzle-orm` itself, which invites two copies in the tree and
 * the confusing type errors that come with them. `db.transaction()` comes from the
 * instance, so a write that spans tables does not need anything else from here.
 */
export { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
