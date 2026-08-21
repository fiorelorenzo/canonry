/**
 * #42, D4 = B (docs/ux/DECISIONS.md), widened by round seventeen V2 = A (#498, #480):
 * the import review screen is the same queue surface the inbox renders inline, scoped
 * to one job, with a type filter chip bar on top - D4's only addition to C6's screen.
 * Import proposals arrive already diffed by job-runner.ts's
 * `materializeDocumentProposals`, so unlike a propagation plan (proposals/[plan]) there is
 * no C3 checklist phase here: straight to the queue.
 *
 * `accept` differs from the plan route's own action: an import proposal's accept also has
 * to write `entity_source_ref` (SPEC.md §6.4), so this calls `@canonry/import`'s
 * `acceptAnyImportProposal` instead of the bare `acceptProposal` - never re-reading the
 * source document, since the content hash and source path it needs are already sitting on
 * the proposal's own `evidence` column (job-runner.ts's `matchEvidence`, threaded down
 * from the same `contentHashByDocument` the run itself used to decide whether to skip a
 * document).
 *
 * No bulk control lives on this route at all, in either direction. Issue #498 tightened
 * this past D4's own original allowance for a filtered bulk reject ("a chip's context
 * menu offers 'Reject all N shown'"): guardrail 1's wording now reads "no bulk control
 * anywhere on the page, not behind a dialog and not for a group", so that action is
 * gone. Every proposal this route shows goes through C6's one-at-a-time accept or
 * reject action below, same as everywhere else this queue renders.
 */
import { error, fail } from '@sveltejs/kit';
import { missingEntitySourceRefsForJob, universeAccessBySlug } from '@canonry/db';
import { acceptAnyImportProposal, type AcceptImportProposalInput } from '@canonry/import';
import { messages } from '$lib/i18n';
import { db } from '$lib/server/db';
import {
	importJobDetailFor,
	enrichCandidates,
	rejectProposal,
	setRejectReason,
	undoAcceptedProposal,
	ProposalNotFoundError,
	ProposalAlreadyDecidedError,
	ProposalNotAcceptedError,
	UndoNotPossibleError,
	type ProposalCandidate,
	type ImportJobDetail
} from '$lib/server/proposals';
import { computeFilterBuckets, type FilterCandidate } from '$lib/components/proposals/importFilter';
import type { Actions, PageServerLoad } from './$types';

async function loadJob(locals: App.Locals, universeSlug: string, jobId: string) {
	const t = messages(locals.locale).import.review.errors;
	if (!locals.user) error(404, t.universeNotFound(universeSlug));
	const conn = db();
	const access = await universeAccessBySlug(conn, universeSlug, locals.user.id);
	if (!access) error(404, t.universeNotFound(universeSlug));
	const detail = await importJobDetailFor(conn, access.universe.id, jobId);
	if (!detail) error(404, t.jobNotFound(jobId, access.universe.name));
	return { conn, access, detail, userId: locals.user.id };
}

/** `proposal.evidence` is untrusted-shape jsonb - job-runner.ts's `matchEvidence` is the
 * only writer for an import proposal, but the column itself carries no schema, so this
 * reads it defensively rather than asserting the shape. A relation proposal's evidence has
 * no `contentHash` (job-runner.ts never threads one through for it - relations create no
 * entity, so `acceptImportProposal` skips the `entity_source_ref` write for them entirely,
 * `appliedRevisionId` stays null), so the empty-string fallback here is never read. */
function importAcceptFields(
	row: ProposalCandidate['proposal'],
	job: ImportJobDetail['job']
): Omit<AcceptImportProposalInput, 'proposalId' | 'decidedBy'> {
	const evidence = row.evidence as {
		sourceRef?: { path?: string | null };
		contentHash?: string;
	} | null;
	return {
		sourceSystem: job.sourceType,
		externalId: evidence?.sourceRef?.path ?? null,
		sourceUrl: null,
		contentHash: evidence?.contentHash ?? '',
		importJobId: job.id
	};
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const { conn, access, detail } = await loadJob(locals, params.universe, params.job);
	const filterCandidates: FilterCandidate[] = detail.candidates.map((c) => ({
		id: c.proposal.id,
		filterType: c.filterType,
		outcome: c.proposal.outcome
	}));
	// issue #163, SPEC.md §6.4: entities this job's merge engine found missing from the
	// source, never deleted - a fact for the GM to act on, not a proposal (guardrail 1's
	// exception: a merge-engine write, not a model's). Scoped to this job's own id
	// (`missingEntitySourceRefsForJob`'s own comment), so an earlier job's find stays on
	// that job's review screen rather than repeating here.
	const missingFromSource = (await missingEntitySourceRefsForJob(conn, detail.job.id)).map(
		(row) => ({
			id: row.entityId,
			name: row.name,
			slug: row.slug,
			type: row.type
		})
	);

	return {
		universe: { slug: access.universe.slug, name: access.universe.name },
		job: {
			id: detail.job.id,
			sourceType: detail.job.sourceType,
			playbook: detail.job.playbook,
			status: detail.job.status,
			outcomeNote: detail.job.outcomeNote,
			proposalsEmitted: detail.job.proposalsEmitted,
			documentCount: detail.job.documentCount
		},
		candidates: enrichCandidates(detail.candidates),
		filterTypeById: Object.fromEntries(detail.candidates.map((c) => [c.proposal.id, c.filterType])),
		buckets: computeFilterBuckets(filterCandidates, locals.locale),
		missingFromSource
	};
};

export const actions: Actions = {
	accept: async ({ request, params, locals }) => {
		const { conn, detail, userId } = await loadJob(locals, params.universe, params.job);
		const t = messages(locals.locale).import.review.errors;
		const data = await request.formData();
		const proposalId = data.get('proposalId');
		if (typeof proposalId !== 'string') return fail(400, { error: t.missingProposalId });
		const candidate = detail.candidates.find((c) => c.proposal.id === proposalId);
		if (!candidate) return fail(404, { error: t.proposalNotFound(proposalId) });
		try {
			const accepted = await acceptAnyImportProposal(conn, candidate.proposal.kind, {
				proposalId,
				decidedBy: userId,
				...importAcceptFields(candidate.proposal, detail.job)
			});
			return { id: accepted.id };
		} catch (err) {
			if (err instanceof ProposalNotFoundError || err instanceof ProposalAlreadyDecidedError) {
				return fail(409, { error: err.message });
			}
			throw err;
		}
	},

	reject: async ({ request, params, locals }) => {
		const { conn, userId } = await loadJob(locals, params.universe, params.job);
		const t = messages(locals.locale).import.review.errors;
		const data = await request.formData();
		const proposalId = data.get('proposalId');
		if (typeof proposalId !== 'string') return fail(400, { error: t.missingProposalId });
		try {
			const rejected = await rejectProposal(conn, { proposalId, reason: null, decidedBy: userId });
			return { id: rejected.id };
		} catch (err) {
			if (err instanceof ProposalNotFoundError || err instanceof ProposalAlreadyDecidedError) {
				return fail(409, { error: err.message });
			}
			throw err;
		}
	},

	setRejectReason: async ({ request, params, locals }) => {
		await loadJob(locals, params.universe, params.job);
		const t = messages(locals.locale).import.review.errors;
		const data = await request.formData();
		const proposalId = data.get('proposalId');
		const reason = data.get('reason');
		if (typeof proposalId !== 'string' || typeof reason !== 'string') {
			return fail(400, { error: t.missingProposalOrReason });
		}
		const updated = await setRejectReason(db(), proposalId, reason);
		if (!updated) return fail(409, { error: t.proposalNotRejected });
		return { id: updated.id, reason: updated.rejectReason };
	},

	undo: async ({ request, params, locals }) => {
		const { conn } = await loadJob(locals, params.universe, params.job);
		const t = messages(locals.locale).import.review.errors;
		const data = await request.formData();
		const proposalId = data.get('proposalId');
		if (typeof proposalId !== 'string') return fail(400, { error: t.missingProposalId });
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
