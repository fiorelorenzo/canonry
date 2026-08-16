/**
 * #42, D4 = B (docs/ux/DECISIONS.md): the import review screen. C6's own queue
 * (ProposalQueue.svelte, already verified for #51) reused unchanged, with a type filter
 * chip bar on top - D4's only addition to C6's screen (docs/ux/d4-import-review.html,
 * "What I would take"). Import proposals arrive already diffed by job-runner.ts's
 * `materializeDocumentProposals`, so unlike a propagation plan (proposals/[plan]) there is
 * no C3 checklist phase here: straight to the queue.
 *
 * `accept` differs from the plan route's own action: an import proposal's accept also has
 * to write `entity_source_ref` (SPEC.md §6.4), so this calls `@canonry/import`'s
 * `acceptImportProposal` instead of the bare `acceptProposal` - never re-reading the
 * source document, since the content hash and source path it needs are already sitting on
 * the proposal's own `evidence` column (job-runner.ts's `matchEvidence`, threaded down
 * from the same `contentHashByDocument` the run itself used to decide whether to skip a
 * document).
 *
 * Bulk accept never appears anywhere on this route. SPEC.md §6.4's one non-destructive
 * bulk exception - a field unchanged since the last import, matched by exact source id -
 * is applied silently by the merge engine before a `proposal` row for it ever exists
 * (§6.4's merge table: "Field unchanged since the last import: update silently"), so it
 * never reaches this queue to accept in bulk. Every proposal this route shows writes
 * prose or a relation and goes through C6's one-at-a-time accept action below - see
 * d4-import-review.html's "What this locks in": "#42 ships as bulk meaning bulk reject
 * and bulk navigation only... accept never actually batches, only reject does." `reject`
 * and `rejectFiltered` are safe to batch precisely because rejecting writes nothing to
 * canon (same page, "Why this is a decision").
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
	},

	// D4 = B's one bulk action: "a chip's context menu offers 'Reject all N shown'
	// whenever a filter is active" - TypeFilterChips.svelte only ever renders this form
	// for a non-"All" chip. Recomputes the filtered pending set fresh from the database
	// rather than trusting a client-submitted id list, so a proposal decided from the
	// keyboard queue a moment earlier is never double-acted on here.
	rejectFiltered: async ({ request, params, locals }) => {
		const { conn, detail, userId } = await loadJob(locals, params.universe, params.job);
		const t = messages(locals.locale).import.review.errors;
		const data = await request.formData();
		const type = data.get('type');
		if (typeof type !== 'string' || type.length === 0) {
			return fail(400, { error: t.missingFilterType });
		}

		const matches = detail.candidates.filter(
			(c) => c.filterType === type && c.proposal.outcome === 'pending'
		);
		const rejectedIds: string[] = [];
		for (const candidate of matches) {
			const rejected = await rejectProposal(conn, {
				proposalId: candidate.proposal.id,
				reason: null,
				decidedBy: userId
			});
			rejectedIds.push(rejected.id);
		}
		return { type, rejectedIds, count: rejectedIds.length };
	}
};
