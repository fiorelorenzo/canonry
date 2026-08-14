export { closeDb, createDb, ping, type Db } from './client.js';
export { runMigrations } from './migrate.js';
export { factWithSource, type FactWithSource } from './queries/facts.js';
export { relationsFor, type RelationView } from './queries/relations.js';
export { historyFor } from './queries/revisions.js';
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
	ProposalNotFoundError,
	ProposalPlanNotFoundError,
	ProposalAlreadyDecidedError,
	ProposalHasDiffError,
	type ProposalRow,
	type ProposalPlanRow,
	type CreateProposalPlanCandidate,
	type CreateProposalPlanInput,
	type CreateProposalPlanResult,
	type DropCandidateResult,
	type RecordProposalDiffInput,
	type RejectedProposalRecord,
	type AcceptProposalInput,
	type RejectProposalInput
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
	InsufficientCreditsError,
	WarmBudgetExhaustedError,
	type Balance,
	type ChargeInput,
	type ChargeResult,
	type SpendCreditsInput,
	type SpendCreditsResult,
	type WarmSpendInput
} from './queries/billing.js';
export { universeAccessBySlug, universesForUser, type UniverseAccess } from './queries/access.js';
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
	listPublicEntities,
	publicEntityBySlug,
	type RevelationRow,
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
	type PublicEntity
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
	type ImageModelRow,
	type UpsertImageModelInput,
	type EntryStyleContext,
	type MediaAssetRow,
	type CreateMediaAssetInput
} from './queries/media.js';
export {
	createImportJob,
	getImportJob,
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
	recordEntitySourceRef,
	findOrCreateRelationType,
	acceptImportProposal,
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
	type RecordEntitySourceRefInput,
	type FindOrCreateRelationTypeInput,
	type AcceptImportProposalInput
} from './queries/import.js';

/**
 * The query operators, re-exported from the one drizzle this workspace installs.
 * Consumers need `eq` and friends the moment they write anything, and the alternative
 * is every app declaring `drizzle-orm` itself, which invites two copies in the tree and
 * the confusing type errors that come with them. `db.transaction()` comes from the
 * instance, so a write that spans tables does not need anything else from here.
 */
export { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
