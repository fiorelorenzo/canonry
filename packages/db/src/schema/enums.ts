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

// SPEC.md §11.5: "agent (loremaster, propagate, warm, indexing)".
export const modelCallAgentEnum = pgEnum('model_call_agent', [
	'loremaster',
	'propagate',
	'warm',
	'indexing'
]);
export type ModelCallAgent = (typeof modelCallAgentEnum.enumValues)[number];
