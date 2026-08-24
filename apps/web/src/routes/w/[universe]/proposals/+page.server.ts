/**
 * #47/#51, widened by round seventeen V2 = A (#498, docs/design/DECISIONS.md): the inbox is
 * the queue now, not a row of links to it. Every propagation plan and import job that
 * still carries a pending proposal is resolved to its full candidate list here
 * (`propagationGroupsForInbox`/`importGroupsForInbox`), so the page below can render
 * each one as `ProposalQueue` groups - never merged into one plan's candidates, since
 * D4's hundreds and C3's tens still get separate reviewers, just both readable from this
 * one page instead of two.
 *
 * `accept` is the one action that differs from the plan route's own: a candidate here
 * might belong to a propagation plan or to an import job, and only the import path also
 * has to write `entity_source_ref` (SPEC.md Β§6.4). `acceptAnyProposalForUniverse`
 * carries that dispatch so this file does not have to know which kind of plan a
 * `proposalId` belongs to before deciding it. Reject/undo/setRejectReason never needed
 * the split - they write nothing about a proposal's origin.
 */
import { error, fail } from '@sveltejs/kit';
import { priceOf, universeAccessBySlug } from '@canonry/db';
import { db } from '$lib/server/db';
import {
	propagationGroupsForInbox,
	importGroupsForInbox,
	planlessCandidatesForInbox,
	enrichCandidates,
	acceptAnyProposalForUniverse,
	rejectProposal,
	setRejectReason,
	undoAcceptedProposal,
	ProposalNotFoundError,
	ProposalAlreadyDecidedError,
	ProposalCannotBeAcceptedError,
	ProposalNotAcceptedError,
	UndoNotPossibleError
} from '$lib/server/proposals';
import type { Actions, PageServerLoad } from './$types';

async function loadAccess(locals: App.Locals, universeSlug: string) {
	if (!locals.user) error(404, `No universe named "${universeSlug}"`);
	const conn = db();
	const access = await universeAccessBySlug(conn, universeSlug, locals.user.id);
	if (!access) error(404, `No universe named "${universeSlug}"`);
	return { conn, access, userId: locals.user.id };
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const { conn, access } = await loadAccess(locals, params.universe);

	// `propagate.diff` prices every awaiting-diff candidate the inbox might show,
	// regardless of which plan it is waiting in (issue #468's own reuse) - one lookup
	// for the whole page rather than one per plan.
	const [planGroups, importGroups, planless, diffPrice] = await Promise.all([
		propagationGroupsForInbox(conn, access.universe.id),
		importGroupsForInbox(conn, access.universe.id),
		// Round eighteen: a pending proposal with no plan is still pending, and both queries
		// above start from a plan, so without this one the sidebar's count and this page
		// disagreed - the warm cache's own NPC draft (`packages/warm/src/store.ts`) writes
		// exactly that row. See `planlessCandidatesForInbox`'s own comment.
		planlessCandidatesForInbox(conn, access.universe.id),
		priceOf(conn, 'propagate.diff')
	]);

	return {
		universe: { slug: access.universe.slug, name: access.universe.name },
		diffPriceCredits: diffPrice.credits,
		planGroups: planGroups.map((g) => ({
			id: g.plan.id,
			trigger: g.plan.trigger,
			triggerEntityName: g.triggerEntityName,
			createdAt: g.plan.createdAt,
			total: g.candidates.length,
			candidates: enrichCandidates(g.candidates)
		})),
		importGroups: importGroups.map((g) => ({
			id: g.job.id,
			playbook: g.job.playbook,
			createdAt: g.job.createdAt,
			total: g.candidates.length,
			candidates: enrichCandidates(g.candidates)
		})),
		planlessCandidates: enrichCandidates(planless)
	};
};

export const actions: Actions = {
	accept: async ({ request, params, locals }) => {
		const { conn, access, userId } = await loadAccess(locals, params.universe);
		const data = await request.formData();
		const proposalId = data.get('proposalId');
		if (typeof proposalId !== 'string') return fail(400, { error: 'Missing proposalId' });
		try {
			const accepted = await acceptAnyProposalForUniverse(
				conn,
				access.universe.id,
				proposalId,
				userId
			);
			return { id: accepted.id };
		} catch (err) {
			if (
				err instanceof ProposalNotFoundError ||
				err instanceof ProposalAlreadyDecidedError ||
				// Issue #498: the inbox is the first surface that ever lets an audit
				// flag's own kind ('flag', no patch) reach this accept action - it used
				// to be reachable only through a plan's post-diff queue, and an audit
				// plan never leaves `status: 'ready'` in practice (see `planDetailFor`'s
				// own caller, the plan route, which only ever shows the checklist for
				// one). `acceptProposal` already refuses this kind at the database layer
				// (SPEC.md Β§5.2: a flag has nothing to write to canon); this only keeps
				// that refusal from surfacing as an unhandled 500 here.
				err instanceof ProposalCannotBeAcceptedError
			) {
				return fail(409, { error: err.message });
			}
			throw err;
		}
	},

	reject: async ({ request, params, locals }) => {
		const { conn, userId } = await loadAccess(locals, params.universe);
		const data = await request.formData();
		const proposalId = data.get('proposalId');
		if (typeof proposalId !== 'string') return fail(400, { error: 'Missing proposalId' });
		try {
			const rejected = await rejectProposal(conn, {
				proposalId,
				reason: null,
				decidedBy: userId
			});
			return { id: rejected.id };
		} catch (err) {
			if (err instanceof ProposalNotFoundError || err instanceof ProposalAlreadyDecidedError) {
				return fail(409, { error: err.message });
			}
			throw err;
		}
	},

	setRejectReason: async ({ request, params, locals }) => {
		await loadAccess(locals, params.universe);
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
		const { conn } = await loadAccess(locals, params.universe);
		const data = await request.formData();
		const proposalId = data.get('proposalId');
		if (typeof proposalId !== 'string') return fail(400, { error: 'Missing proposalId' });
		try {
			const undone = await undoAcceptedProposal(conn, { proposalId });
			return { id: undone.id };
		} catch (err) {
			if (err instanceof ProposalNotAcceptedError || err instanceof UndoNotPossibleError) {
				return fail(409, { error: err.message });
			}
			throw err;
		}
	}
};
