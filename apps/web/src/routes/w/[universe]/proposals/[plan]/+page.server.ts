/**
 * #51: one propagation plan. C3's flat checklist while `plan.status !== 'spent'` (no
 * diffs generated yet, dropping a candidate is still free); C4/C5/C6's keyboard queue once
 * it is. Accept, reject, undo and the reason chip all live here - C4's "what this locks
 * in": accept and reject live on this screen, never on the plan list or the inbox.
 */
import { error, fail } from '@sveltejs/kit';
import { messages } from '$lib/i18n';
import { priceOf, universeAccessBySlug } from '@canonry/db';
import { generatePlanDiffs, AiDisabledError } from '@canonry/copilot';
import { MissingGatewayEnvError } from '@canonry/ai';
import { db } from '$lib/server/db';
import { scheduleIndexAfterAccept } from '$lib/server/jobs';
import { PLAN_CREDITS_LINE } from '$lib/proposals/creditsLine';
import { modelFactory, identityGateway } from '$lib/server/copilot';
import {
	planDetailFor,
	enrichCandidates,
	acceptProposal,
	rejectProposal,
	setRejectReason,
	undoAcceptedProposal,
	dropCandidateFromPlan,
	ProposalNotFoundError,
	ProposalAlreadyDecidedError,
	ProposalNotAcceptedError,
	UndoNotPossibleError
} from '$lib/server/proposals';
import type { Actions, PageServerLoad } from './$types';

async function loadPlan(locals: App.Locals, universeSlug: string, planId: string) {
	if (!locals.user) error(404, `No universe named "${universeSlug}"`);
	const conn = db();
	const access = await universeAccessBySlug(conn, universeSlug, locals.user.id);
	if (!access) error(404, `No universe named "${universeSlug}"`);
	const detail = await planDetailFor(conn, access.universe.id, planId);
	if (!detail) error(404, `No plan "${planId}" in ${access.universe.name}`);
	return { conn, access, detail, userId: locals.user.id };
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const { conn, access, detail } = await loadPlan(locals, params.universe, params.plan);

	// Issue #489: `propagate.diff` prices per candidate (docs/design/DECISIONS.md G11), so a
	// propagation plan shows the reconciling count x price = total, plus the plan-level
	// `propagate.plan` ranking charge as its own already-spent figure. Both are looked up
	// live rather than trusted from the plan's stored `estimated_credits`, which is not
	// decomposable into the three figures this screen has to reconcile. Issue #508 has since
	// made that column mean one thing - what the plan's still-open candidates are worth,
	// moved by every accept, reject and drop - and taken the plan-level ranking charge out of
	// it; this screen still derives its own figures, because a display needs the price and
	// the count separately and not their product.
	//
	// Issue #572: which line every other trigger reads is decided once, as a total record
	// over `proposal_trigger`, in `$lib/proposals/creditsLine.ts`. An audit flag, a
	// completion and an Ask draft are all written already drafted and already charged, so
	// their figure is a charge and says so; an import and a table quick action are priced
	// per document and per action, so their plan figure is zero by construction and the line
	// carries no number at all.
	const line = PLAN_CREDITS_LINE[detail.plan.trigger];
	const pricing =
		line.kind === 'perDiff'
			? await (async () => {
					const [diffPrice, planPrice] = await Promise.all([
						priceOf(conn, 'propagate.diff'),
						priceOf(conn, 'propagate.plan')
					]);
					return {
						kind: 'perDiff' as const,
						diffPriceCredits: diffPrice.credits,
						alreadySpentCredits: planPrice.credits
					};
				})()
			: line.kind === 'spent'
				? {
						kind: 'spent' as const,
						trigger: line.trigger,
						estimatedCredits: detail.plan.estimatedCredits
					}
				: { kind: 'chargedElsewhere' as const, trigger: line.trigger };

	return {
		universe: { slug: access.universe.slug, name: access.universe.name },
		plan: {
			id: detail.plan.id,
			status: detail.plan.status,
			// issue #270: the heading names where this plan came from, and the trigger is the
			// only field that actually knows - `triggerEntityName` alone used to leave every
			// plan without one reading "from propagation", import and Ask included.
			trigger: detail.plan.trigger,
			summary: detail.plan.summary,
			candidateCap: detail.plan.candidateCap
		},
		pricing,
		triggerEntityName: detail.triggerEntityName,
		checklistRows: detail.candidates
			.filter((c) => c.proposal.outcome === 'pending')
			.map((c) => ({
				id: c.proposal.id,
				name:
					c.targetEntity?.name ??
					c.relatedEntity?.name ??
					messages(locals.locale).proposals.diffCard.newEntry,
				rationale: c.proposal.rationale,
				// The row's own price: propagation's uniform, not-yet-spent `propagate.diff`
				// price while a diff is still to come, or the candidate's own real, already
				// spent cost for anything else (an audit flag is fully priced when written -
				// never 0, unlike an undiffed propagation candidate, which always was).
				credits: pricing.kind === 'perDiff' ? pricing.diffPriceCredits : c.proposal.credits
			})),
		diffCandidates: enrichCandidates(detail.candidates)
	};
};

export const actions: Actions = {
	drop: async ({ request, params, locals }) => {
		await loadPlan(locals, params.universe, params.plan);
		const data = await request.formData();
		const proposalId = data.get('proposalId');
		if (typeof proposalId !== 'string') return fail(400, { error: 'Missing proposalId' });
		try {
			await dropCandidateFromPlan(db(), proposalId);
			return { id: proposalId };
		} catch (err) {
			if (err instanceof ProposalNotFoundError) return fail(404, { error: err.message });
			throw err;
		}
	},

	generateDiffs: async ({ params, locals }) => {
		const { conn, access, detail, userId } = await loadPlan(locals, params.universe, params.plan);
		const triggerEntityName = detail.triggerEntityName ?? 'the edited entry';
		// A propagation plan always has the entry whose edit produced it. A plan without one is
		// an import plan, whose diffs are written by the import run itself, so there is nothing
		// for this action to generate and saying so beats passing an empty id down two layers.
		const triggerEntityId = detail.plan.triggerEntityId;
		if (!triggerEntityId) {
			error(400, messages(locals.locale).proposals.errors.noDiffsToGenerate);
		}
		// The plan's own summary carries the edit's semantic diff nowhere on the row -
		// generatePlanDiffs needs it fresh; propagation always stores the edit's meaning in
		// the plan's summary text at creation, so re-deriving it here would require the
		// original before/after bodies this route does not have. It reads whatever
		// planPropagation already wrote onto each candidate's rationale/evidence instead,
		// which is what generatePlanDiffs itself actually consumes per candidate.
		try {
			await generatePlanDiffs({
				db: conn,
				userId,
				universeId: access.universe.id,
				planId: detail.plan.id,
				editedEntityId: triggerEntityId,
				editedEntityName: triggerEntityName,
				diff: [],
				// The reader's language for each diff's summary; the target entry's own language for
				// the drafted prose, which `generatePlanDiffs` reads per candidate (SPEC.md §17).
				locale: locals.locale,
				modelFactory,
				gateway: identityGateway
			});
		} catch (err) {
			if (err instanceof MissingGatewayEnvError || err instanceof AiDisabledError) {
				return fail(503, {
					error: `Cannot generate diffs: ${err.message}`
				});
			}
			throw err;
		}
		return { generated: true };
	},

	accept: async ({ request, params, locals }) => {
		const { userId } = await loadPlan(locals, params.universe, params.plan);
		const data = await request.formData();
		const proposalId = data.get('proposalId');
		if (typeof proposalId !== 'string') return fail(400, { error: 'Missing proposalId' });
		try {
			const accepted = await acceptProposal(db(), { proposalId, decidedBy: userId });
			// Issue #703: an accepted propagation update rewrites a body, so the index has to
			// catch up or every later Ask answer quotes canon that has changed underneath it.
			// Index engine only - the accept must not itself trigger propagation, which is the
			// guard `$lib/server/jobs/canon-save.ts` describes and `scheduleEntityIndexJob`'s
			// input type is what now enforces.
			await scheduleIndexAfterAccept(db(), accepted, { userId, locale: locals.locale });
			return { id: accepted.id };
		} catch (err) {
			if (err instanceof ProposalNotFoundError || err instanceof ProposalAlreadyDecidedError) {
				return fail(409, { error: err.message });
			}
			throw err;
		}
	},

	reject: async ({ request, params, locals }) => {
		const { userId } = await loadPlan(locals, params.universe, params.plan);
		const data = await request.formData();
		const proposalId = data.get('proposalId');
		if (typeof proposalId !== 'string') return fail(400, { error: 'Missing proposalId' });
		try {
			const rejected = await rejectProposal(db(), { proposalId, reason: null, decidedBy: userId });
			return { id: rejected.id };
		} catch (err) {
			if (err instanceof ProposalNotFoundError || err instanceof ProposalAlreadyDecidedError) {
				return fail(409, { error: err.message });
			}
			throw err;
		}
	},

	setRejectReason: async ({ request, params, locals }) => {
		await loadPlan(locals, params.universe, params.plan);
		const data = await request.formData();
		const proposalId = data.get('proposalId');
		const reason = data.get('reason');
		if (typeof proposalId !== 'string' || typeof reason !== 'string') {
			return fail(400, { error: 'Missing proposalId or reason' });
		}
		const updated = await setRejectReason(db(), proposalId, reason);
		if (!updated) return fail(409, { error: 'Proposal is not rejected' });
		return { id: updated.id, reason: updated.rejectReason };
	},

	undo: async ({ request, params, locals }) => {
		await loadPlan(locals, params.universe, params.plan);
		const data = await request.formData();
		const proposalId = data.get('proposalId');
		if (typeof proposalId !== 'string') return fail(400, { error: 'Missing proposalId' });
		try {
			const undone = await undoAcceptedProposal(db(), { proposalId });
			return { id: undone.id };
		} catch (err) {
			if (err instanceof ProposalNotAcceptedError || err instanceof UndoNotPossibleError) {
				return fail(409, { error: err.message });
			}
			throw err;
		}
	}
};
