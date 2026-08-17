import { pgEnum } from 'drizzle-orm/pg-core';

// A revision is either made by a human directly, or is AI-generated text a human
// explicitly accepted. There is no third path: nothing else ever creates a revision,
// which is guardrail 1 (SPEC.md §3.1) enforced at the schema level.
export const authorKindEnum = pgEnum('author_kind', ['human', 'ai_accepted']);
export type AuthorKind = (typeof authorKindEnum.enumValues)[number];

export const universeKindEnum = pgEnum('universe_kind', ['homebrew', 'derived']);
export type UniverseKind = (typeof universeKindEnum.enumValues)[number];

export const universeMemberRoleEnum = pgEnum('universe_member_role', ['owner', 'editor', 'viewer']);
export type UniverseMemberRole = (typeof universeMemberRoleEnum.enumValues)[number];

// SPEC.md §4.2: "a typed entry: character, place, faction, item, event, session" - exactly
// these six.
export const entityTypeEnum = pgEnum('entity_type', [
	'character',
	'place',
	'faction',
	'item',
	'event',
	'session'
]);
export type EntityType = (typeof entityTypeEnum.enumValues)[number];

// Guardrail 6: a `revealable` entry still needs a `revelation` row (players' wiki, not
// built in this wave) to actually reach players. `gm_only` can never be revealed at all.
export const entityVisibilityEnum = pgEnum('entity_visibility', ['gm_only', 'revealable']);
export type EntityVisibility = (typeof entityVisibilityEnum.enumValues)[number];

export const relationCardinalityEnum = pgEnum('relation_cardinality', [
	'one_to_one',
	'one_to_many',
	'many_to_one',
	'many_to_many'
]);
export type RelationCardinality = (typeof relationCardinalityEnum.enumValues)[number];

// Matches @canonry/ai's ModelPurpose union exactly (shared contract for this wave).
export const modelPurposeEnum = pgEnum('model_purpose', [
	'cheap',
	'premium',
	'multimodal',
	'embedding',
	'image'
]);
export type ModelPurpose = (typeof modelPurposeEnum.enumValues)[number];

// SPEC.md §11.5 lists loremaster, propagate, warm and indexing. 'media' is the fifth and
// it is not in that list because §11.5 was written about text: a GM pressing Generate is
// none of the other four, and attributing an image to 'warm' would corrupt the warm hit
// rate of §14 with calls nobody pre-computed. 'import' is the sixth (issue #133): every
// model call an import job makes writes its own model_call row here, one per call rather
// than a job-level total, so "which playbook step is expensive" stays answerable - see
// packages/import/src/job-runner.ts's handleEvent. Priced at zero credits regardless of
// the row's real cost_eur: the user-facing charge for an import stays the flat
// operation_price('import.document') spend it already was, applied once per document, so
// writing these rows never charges twice - see spendCredits's modelCallId parameter for
// how the existing charge now points at one of them.
export const modelCallAgentEnum = pgEnum('model_call_agent', [
	'loremaster',
	'propagate',
	'warm',
	'indexing',
	'media',
	'import'
]);
export type ModelCallAgent = (typeof modelCallAgentEnum.enumValues)[number];

// SPEC.md §15, issue #113: what a priced operation is, for the admin panel's grouping
// and for the seeded catalogue - reading stays at zero, generation and import are what
// actually gets priced.
export const operationPriceKindEnum = pgEnum('operation_price_kind', [
	'generation',
	'reading',
	'import'
]);
export type OperationPriceKind = (typeof operationPriceKindEnum.enumValues)[number];

// SPEC.md §5: the four modes of the Loremaster all produce a proposal, so the trigger says
// which mode produced this one. 'import' is the fifth producer (SPEC.md §6), and it lands
// in the same accept flow on purpose: one shape, one instrumentation.
export const proposalTriggerEnum = pgEnum('proposal_trigger', [
	'save',
	'complete',
	'audit',
	'import',
	'table'
]);
export type ProposalTrigger = (typeof proposalTriggerEnum.enumValues)[number];

// SPEC.md §4.4 lists create, update, relation and draft_entity. 'flag' is the fifth and it
// is the odd one out on purpose: an audit flag (§5.2) is not a change waiting to be applied,
// it is a question about two statements that disagree, so it has no patch and there is
// nothing to write to canon. Giving it its own kind rather than storing it as an 'update'
// with an empty patch means the accept path can refuse it outright, and means the accept
// rate of §14 does not have to remember to filter by trigger to stay honest.
//
// Decision K1 and issue #190: 'relation_type_reuse', 'relation_type_widen' and
// 'relation_type_new' are the three non-'existing' outcomes of
// `@canonry/copilot`'s `resolveRelationType` (issue #189). A relation type is
// vocabulary for a whole world, a bigger act than one edge, so guardrail 1 puts a human
// on the write - these three kinds are that write's proposal, never the type itself
// appearing as a side effect of an import. Each carries its patch as one vocabulary
// question plus the relation(s) waiting on its answer (job-runner.ts's own comment on
// `materializeDocumentProposals` has the shape); accepting is the only path that ever
// creates or widens a `relation_type` row from an import, and it never writes a
// `relation` row directly either - it unblocks the waiting relation(s) into their own
// pending `relation`-kind proposals, so each still gets its own accept and the
// allowed_from/allowed_to check on that accept path (issue #191) is never bypassed.
export const proposalKindEnum = pgEnum('proposal_kind', [
	'create',
	'update',
	'relation',
	'draft_entity',
	'flag',
	'relation_type_reuse',
	'relation_type_widen',
	'relation_type_new'
]);
export type ProposalKind = (typeof proposalKindEnum.enumValues)[number];

// 'superseded' is for a proposal whose target changed underneath it before anyone decided:
// it is neither accepted nor rejected, and counting it as a rejection would poison the
// accept rate that SPEC.md §14 makes the deciding metric.
export const proposalOutcomeEnum = pgEnum('proposal_outcome', [
	'pending',
	'accepted',
	'rejected',
	'superseded'
]);
export type ProposalOutcome = (typeof proposalOutcomeEnum.enumValues)[number];

// A plan is planned, then ready for review, then spent once its diffs exist, or dismissed
// if the GM dropped everything in it.
export const proposalPlanStatusEnum = pgEnum('proposal_plan_status', [
	'planning',
	'ready',
	'spent',
	'dismissed'
]);
export type ProposalPlanStatus = (typeof proposalPlanStatusEnum.enumValues)[number];

// SPEC.md §4.3: "a oneshot, a campaign module, a long campaign, a short story or a novel".
export const workTypeEnum = pgEnum('work_type', [
	'oneshot',
	'module',
	'campaign',
	'story',
	'novel'
]);
export type WorkType = (typeof workTypeEnum.enumValues)[number];

export const workStatusEnum = pgEnum('work_status', [
	'planning',
	'running',
	'finished',
	'abandoned'
]);
export type WorkStatus = (typeof workStatusEnum.enumValues)[number];

// SPEC.md §4.3: "an ordered tree of work_node (act / chapter / scene / encounter)".
export const workNodeKindEnum = pgEnum('work_node_kind', ['act', 'chapter', 'scene', 'encounter']);
export type WorkNodeKind = (typeof workNodeKindEnum.enumValues)[number];

// What was revealed. A fact or a relation is finer than an entry, which decision E5 needs:
// a party can learn that Aldric was dismissed without learning everything about him.
export const revelationKindEnum = pgEnum('revelation_kind', ['entity', 'fact', 'relation']);
export type RevelationKind = (typeof revelationKindEnum.enumValues)[number];

// SPEC.md §4.5: "warm_artifact holds pre-computed material: brief, npc_draft,
// ambient_pack, portrait, context_pack".
export const warmArtifactKindEnum = pgEnum('warm_artifact_kind', [
	'brief',
	'npc_draft',
	'ambient_pack',
	'portrait',
	'context_pack'
]);
export type WarmArtifactKind = (typeof warmArtifactKindEnum.enumValues)[number];

// SPEC.md §9: one active image model per feature. 'variants' is the batch case, which is
// the only place the four-image model is used.
export const imageFeatureEnum = pgEnum('image_feature', ['portrait', 'variants', 'scene']);
export type ImageFeature = (typeof imageFeatureEnum.enumValues)[number];

export const mediaKindEnum = pgEnum('media_kind', ['image', 'audio']);
export type MediaKind = (typeof mediaKindEnum.enumValues)[number];

// SPEC.md §6.7 and §6.1: a job waits in the queue, runs, and then either finishes, stops
// at its ceiling with its proposals intact, is cancelled, or fails. 'stopped_at_ceiling' is
// its own state because it is resumable and a failure is not.
export const importJobStatusEnum = pgEnum('import_job_status', [
	'queued',
	'running',
	'finished',
	'stopped_at_ceiling',
	'cancelled',
	'failed'
]);
export type ImportJobStatus = (typeof importJobStatusEnum.enumValues)[number];

// SPEC.md §7: "data_source rows track type (wiki | pdf | text)".
export const dataSourceTypeEnum = pgEnum('data_source_type', ['wiki', 'pdf', 'text']);
export type DataSourceType = (typeof dataSourceTypeEnum.enumValues)[number];

// 'licence_review_pending' is deliberately a status rather than a boolean: SPEC.md §7 wants
// the review to happen before indexing, so an unreviewed source has to be unindexable by
// state rather than by convention.
export const dataSourceStatusEnum = pgEnum('data_source_status', [
	'licence_review_pending',
	'pending',
	'indexing',
	'indexed',
	'failed',
	'excluded'
]);
export type DataSourceStatus = (typeof dataSourceStatusEnum.enumValues)[number];

export const creditTransactionKindEnum = pgEnum('credit_transaction_kind', [
	'grant',
	'spend',
	'refund',
	'expiry'
]);
export type CreditTransactionKind = (typeof creditTransactionKindEnum.enumValues)[number];

// SPEC.md §17. Where `entity.language` came from, which the language itself cannot express:
// null with 'detected' means nobody has established a language yet and the next save may try
// again, while null with 'human' means the GM looked at it and said the entry is mixed or
// unknown, which must stick forever. A boolean flag would carry the same information and say
// less: this records provenance, so a future re-detection pass can safely revisit every
// 'detected' row and must never touch a 'human' one.
export const languageSourceEnum = pgEnum('language_source', ['detected', 'human']);
export type LanguageSource = (typeof languageSourceEnum.enumValues)[number];
