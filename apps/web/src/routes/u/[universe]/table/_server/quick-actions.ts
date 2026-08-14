/**
 * Issue #74, SPEC.md §8's three named quick actions, decision E3 = C (primary: mark as
 * revealed, + NPC here; overflow: + create a child location). Every action that produces
 * canon content is a `proposal`, never a direct write (guardrail 1, and the e3 artifact's
 * own "Rejected outright": "the button names the NPC and the GM just starts using it" is
 * exactly what this module refuses to do). "Mark as revealed" is the one exception, and it
 * is not a guardrail-1 exception at all: it never proposes new canon, it flips an existing,
 * already-reviewed entity's visibility to players (guardrail 6's territory, decision
 * G7/E5's live path), so it writes directly through `revealEntityLive`.
 */
import { randomUUID } from 'node:crypto';
import {
	chargeFor,
	createLanguageModel,
	ModelNotConfiguredError,
	resolveModel,
	type GatewayCredentials
} from '@canonry/ai';
import {
	createProposalPlan,
	recordProposalDiff,
	revealEntityLive,
	type Db,
	type ProposalRow,
	type RevelationRow
} from '@canonry/db';
import { createDbWarmBudgetPort, regenerate, type WarmCandidate } from '@canonry/warm';
import { buildNpcDraftGenerator } from './warm-generator.js';

export interface QuickActionContext {
	db: Db;
	universeId: string;
	userId: string;
	placeEntityId: string;
	placeName: string;
	sessionEntityId: string | null;
	/** A thunk, not an already-resolved value: reading gateway credentials from the
	 * environment can itself throw (`MissingGatewayEnvError`, unset on this box), and that
	 * has to land inside `fireNpcHere`'s own try/catch alongside `ModelNotConfiguredError`
	 * rather than crash the request before the scaffold fallback ever gets a chance to run.
	 * `fireCreateChildLocation` and `fireMarkAsRevealed` never call it at all - neither one
	 * touches a model - so an unset gateway must never stop either of them either. */
	gatewayCredentials: () => GatewayCredentials;
}

export interface NpcHereResult {
	proposal: ProposalRow;
	/** Whether the body actually came from a model, or from the deterministic scaffold
	 * because a real model was unreachable - the UI and the rationale both say which. */
	drafted: 'model' | 'scaffold';
	/** Set only on the scaffold path, so the caller can surface *why* honestly instead of
	 * silently downgrading. */
	unavailableReason?: string;
}

async function scaffoldNpcProposal(
	ctx: QuickActionContext,
	unavailableReason: string
): Promise<ProposalRow> {
	const { plan, proposals } = await createProposalPlan(ctx.db, {
		universeId: ctx.universeId,
		trigger: 'table',
		triggerEntityId: ctx.placeEntityId,
		summary: `NPC scaffold for ${ctx.placeName}, from the "+ NPC here" quick action`,
		candidateCap: 1,
		estimatedCredits: 0,
		candidates: [
			{
				kind: 'draft_entity',
				targetEntityId: null,
				rationale: `Drafted via "+ NPC here" while ${ctx.placeName} was the declared context. AI drafting was unavailable (${unavailableReason}), so this is an empty scaffold for the GM to fill in rather than a discarded tap.`,
				evidence: {
					source: 'table-quick-action',
					action: '+ NPC here',
					placeEntityId: ctx.placeEntityId,
					placeName: ctx.placeName,
					aiUnavailable: unavailableReason
				},
				rank: 0
			}
		]
	});
	const created = proposals[0];
	if (!created) throw new Error('scaffoldNpcProposal: createProposalPlan returned no candidate');
	void plan;
	return recordProposalDiff(ctx.db, {
		proposalId: created.id,
		patch: {
			type: 'character',
			name: `New face at ${ctx.placeName}`,
			slug: `npc-${randomUUID().slice(0, 8)}`,
			aliases: [],
			body: `Encountered at ${ctx.placeName}. Give them a name, a role and a reason the party noticed them.`
		},
		provider: 'canonry-table',
		modelId: 'none (deterministic scaffold)',
		credits: 0
	});
}

/** Attempts a real model-drafted NPC through `packages/warm`'s `regenerate` (so a fresh
 * warm artifact from an earlier "on prep" trigger is reused rather than redrafted, exactly
 * matching #77's warm triggers); falls back to a deterministic, clearly-labelled scaffold
 * proposal on any failure - unconfigured model, unreachable gateway, or a warm budget that
 * has run dry - rather than leaving the GM's tap with nothing to show for it.
 */
export async function fireNpcHere(ctx: QuickActionContext): Promise<NpcHereResult> {
	let resolved;
	try {
		resolved = await resolveModel(ctx.db, 'cheap');
	} catch (err) {
		if (!(err instanceof ModelNotConfiguredError)) throw err;
		return {
			proposal: await scaffoldNpcProposal(ctx, err.message),
			drafted: 'scaffold',
			unavailableReason: err.message
		};
	}

	const candidate: WarmCandidate = {
		universeId: ctx.universeId,
		kind: 'npc_draft',
		subjectEntityId: ctx.placeEntityId,
		sourceEntityIds: [ctx.placeEntityId],
		// A random slot per tap: every "+ NPC here" press is its own candidate, distinct
		// from the 3 slots #77's "on prep" trigger already reserves for this place, and
		// from every earlier tap - never colliding on the (kind, subject, fingerprint)
		// unique index.
		promptVersion: `table-quick-action-npc#${randomUUID()}`,
		modelId: resolved.modelId,
		provider: resolved.provider,
		credits: (await chargeFor(ctx.db, 'warm.npc_draft')).credits,
		rationale: `Drafted via the "+ NPC here" quick action while ${ctx.placeName} was the declared context.`
	};

	try {
		const languageModel = createLanguageModel(
			resolved.provider,
			resolved.modelId,
			ctx.gatewayCredentials()
		);
		const generator = buildNpcDraftGenerator({
			db: ctx.db,
			userId: ctx.userId,
			placeName: ctx.placeName,
			resolved,
			languageModel
		});
		const result = await regenerate(ctx.db, candidate, generator, createDbWarmBudgetPort(ctx.db));
		if (result.proposal) return { proposal: result.proposal, drafted: 'model' };

		// 'fresh' or 'reused' with no proposal attached, or 'degraded' (budget refused the
		// spend) - either way the GM tapped a button and nothing landed in their queue yet.
		const reason =
			result.status === 'degraded'
				? 'the warm budget could not cover this draft right now'
				: `warm status "${result.status}" produced no new proposal`;
		return {
			proposal: await scaffoldNpcProposal(ctx, reason),
			drafted: 'scaffold',
			unavailableReason: reason
		};
	} catch (err) {
		const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
		return {
			proposal: await scaffoldNpcProposal(ctx, reason),
			drafted: 'scaffold',
			unavailableReason: reason
		};
	}
}

/** "Create a child location" (issue #74's own wording, generalising the SPEC's "create an
 * inn" example) - always a deterministic scaffold. No model call: a new place is a name
 * and a parent, not something worth SPEC §8.1's slow lane, and the relation to the parent
 * place cannot be proposed yet (a `relation` proposal needs two *existing* entities on both
 * ends), so it is written into the scaffold body instead, ready for the GM to formalise once
 * they accept and edit it in.
 */
export async function fireCreateChildLocation(
	ctx: QuickActionContext,
	label: string
): Promise<ProposalRow> {
	const { proposals } = await createProposalPlan(ctx.db, {
		universeId: ctx.universeId,
		trigger: 'table',
		triggerEntityId: ctx.placeEntityId,
		summary: `A child location of ${ctx.placeName}, from the "+ create a child location" quick action`,
		candidateCap: 1,
		estimatedCredits: 0,
		candidates: [
			{
				kind: 'create',
				targetEntityId: null,
				rationale: `Created via the child-location quick action while ${ctx.placeName} was the declared context.`,
				evidence: {
					source: 'table-quick-action',
					action: '+ create a child location',
					placeEntityId: ctx.placeEntityId,
					placeName: ctx.placeName
				},
				rank: 0
			}
		]
	});
	const created = proposals[0];
	if (!created)
		throw new Error('fireCreateChildLocation: createProposalPlan returned no candidate');
	return recordProposalDiff(ctx.db, {
		proposalId: created.id,
		patch: {
			type: 'place',
			name: label,
			slug: `${label
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/(^-|-$)/g, '')}-${randomUUID().slice(0, 6)}`,
			aliases: [],
			body: `A location inside ${ctx.placeName}. Add the "located in" relation to ${ctx.placeName} once this is accepted.`
		},
		provider: 'canonry-table',
		modelId: 'none (deterministic scaffold)',
		credits: 0
	});
}

export class NoSessionDeclaredError extends Error {
	constructor() {
		super('mark as revealed needs a declared session - set one when declaring context first');
		this.name = 'NoSessionDeclaredError';
	}
}

/** Decision E5/G7's live path: publishes the current place to the players' wiki
 * immediately, the moment the GM taps it at the table. Not a proposal - the place already
 * is canon, this only flips who may see it. */
export async function fireMarkAsRevealed(
	ctx: QuickActionContext,
	confirmedBy: string
): Promise<RevelationRow> {
	if (!ctx.sessionEntityId) throw new NoSessionDeclaredError();
	return revealEntityLive(ctx.db, {
		universeId: ctx.universeId,
		entityId: ctx.placeEntityId,
		sessionEntityId: ctx.sessionEntityId,
		confirmedBy
	});
}
