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
import { chargeFor, ModelNotConfiguredError, resolveModel } from '@canonry/ai';
import type { GatewayWrapper, ModelFactory } from '@canonry/copilot';
import {
	createProposalPlan,
	recordProposalDiff,
	revealEntityLive,
	setProposalPlanStatus,
	type Db,
	type ProposalRow,
	type RevelationRow
} from '@canonry/db';
import {
	contentLanguageForSubject,
	createDbWarmBudgetPort,
	regenerate,
	type WarmCandidate
} from '@canonry/warm';
import type { Locale } from '@canonry/lang';
import { messages } from '$lib/i18n';
import { buildNpcDraftGenerator } from './warm-generator.js';

export interface QuickActionContext {
	db: Db;
	universeId: string;
	userId: string;
	placeEntityId: string;
	placeName: string;
	/** SPEC.md §17: the GM's interface language, for anything the draft says *to* them. */
	locale: Locale;
	/** The place entity's own recorded language and body, for anything the draft writes *into*
	 * canon. Passed rather than re-queried so the two languages are decided once, at the edge,
	 * where the request already knows both. */
	placeLanguage: string | null;
	placeBody: string;
	sessionEntityId: string | null;
	/** The same injected seam every other AI-consuming route in `apps/web` takes
	 * ($lib/server/copilot.ts's composition root: real in production, a
	 * `MockLanguageModelV4` when `COPILOT_DEV_MOCK_MODEL=1`) - issue #793 found this
	 * module building its own `createLanguageModel` call straight from `@canonry/ai`
	 * instead, which meant the dev-mock env var did nothing for "+ NPC here" and the
	 * scaffold fallback was the only path this action could ever take on a dev box.
	 * Calling `modelFactory` can itself throw (a real, unmocked `createLanguageModel`
	 * reads gateway credentials lazily and throws `MissingGatewayEnvError` when they are
	 * unset), so that call has to land inside `fireNpcHere`'s own try/catch alongside
	 * `ModelNotConfiguredError` rather than crash the request before the scaffold
	 * fallback ever gets a chance to run. `fireCreateChildLocation` and
	 * `fireMarkAsRevealed` never call either seam - neither one touches a model - so an
	 * unset gateway must never stop either of them either. */
	modelFactory: ModelFactory;
	gateway: GatewayWrapper;
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
	const t = messages(ctx.locale).table.server;
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
				rationale: t.npcScaffoldRationale(ctx.placeName, unavailableReason),
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
	const recorded = await recordProposalDiff(ctx.db, {
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
	// Issue #345: the scaffold is written, so nothing is left to generate and the plan says
	// so. A plan left at `ready` sends the review surfaces to C3's checklist, which for a
	// candidate that already carries its prose means an extra click through a "Generate
	// diffs" button with nothing to generate.
	await setProposalPlanStatus(ctx.db, plan.id, 'spent');
	return recorded;
}

/** Attempts a real model-drafted NPC through `packages/warm`'s `regenerate` (so a fresh
 * warm artifact from an earlier "on prep" trigger is reused rather than redrafted, exactly
 * matching #77's warm triggers); falls back to a deterministic, clearly-labelled scaffold
 * proposal on any failure - unconfigured model, unreachable gateway, or a warm budget that
 * has run dry - rather than leaving the GM's tap with nothing to show for it.
 */
export async function fireNpcHere(ctx: QuickActionContext): Promise<NpcHereResult> {
	const t = messages(ctx.locale).table.server;
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
		rationale: t.npcDraftedRationale(ctx.placeName),
		// Two languages, both correct at once (SPEC.md §17): the label the GM reads follows their
		// interface, the NPC's prose follows the place it will be written into.
		locale: ctx.locale,
		contentLanguage: contentLanguageForSubject({
			language: ctx.placeLanguage,
			body: ctx.placeBody
		})
	};

	try {
		const languageModel = ctx.gateway(ctx.modelFactory(resolved));
		const generator = buildNpcDraftGenerator({
			db: ctx.db,
			userId: ctx.userId,
			placeName: ctx.placeName,
			placeLanguage: ctx.placeLanguage,
			placeBody: ctx.placeBody,
			resolved,
			languageModel
		});
		const result = await regenerate(ctx.db, candidate, generator, createDbWarmBudgetPort(ctx.db));
		if (result.proposal) return { proposal: result.proposal, drafted: 'model' };

		// 'fresh' or 'reused' with no proposal attached, or 'degraded' (budget refused the
		// spend) - either way the GM tapped a button and nothing landed in their queue yet.
		const reason =
			result.status === 'degraded'
				? t.warmBudgetUnavailable
				: t.warmStatusNoProposal(result.status);
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
	const t = messages(ctx.locale).table.server;
	const { plan, proposals } = await createProposalPlan(ctx.db, {
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
				rationale: t.createLocationRationale(ctx.placeName),
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
	const recorded = await recordProposalDiff(ctx.db, {
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
	// Issue #345, same reason as `scaffoldNpcProposal` above.
	await setProposalPlanStatus(ctx.db, plan.id, 'spent');
	return recorded;
}

export class NoSessionDeclaredError extends Error {
	constructor(localizedMessage: string) {
		super(localizedMessage);
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
	if (!ctx.sessionEntityId) {
		throw new NoSessionDeclaredError(messages(ctx.locale).table.server.noSessionDeclared);
	}
	return revealEntityLive(ctx.db, {
		universeId: ctx.universeId,
		entityId: ctx.placeEntityId,
		sessionEntityId: ctx.sessionEntityId,
		confirmedBy
	});
}
