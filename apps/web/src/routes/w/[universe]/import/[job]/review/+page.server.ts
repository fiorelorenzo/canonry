/**
 * #42, D4 = B (docs/design/DECISIONS.md), widened by round seventeen V2 = A (#498, #480):
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
import {
	missingEntitySourceRefsForJob,
	universeAccessBySlug,
	widenRelationType,
	RelationTypeNotAdmittedError,
	RelationTypeNotOwnedError
} from '@canonry/db';
import { acceptAnyImportProposal, type AcceptImportProposalInput } from '@canonry/import';
import { messages, type Locale } from '$lib/i18n';
import { db } from '$lib/server/db';
import {
	importJobDetailFor,
	enrichCandidates,
	rejectProposal,
	setRejectReason,
	undoAcceptedProposal,
	ProposalNotFoundError,
	ProposalAlreadyDecidedError,
	RelationEndpointNotAcceptedError,
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

/** Issue #628: `RelationTypeNotAdmittedError`'s refusal, turned into the `fail()` both
 * `accept` (the ordinary path) and `widenAndAccept` (reachable again if the type
 * changed underneath the widen - two tabs, or a second refusal in between) return.
 * #191's admission check is correct as written: the endpoints' real types are only
 * final once the GM has accepted them, so accept time is the first moment the pair is
 * knowable, and propose time can only ever guess. What was wrong before #628 was
 * ending at a failed click with nothing else - this carries exactly what
 * `widenRelationType` needs, so the card can offer the GM's consent to widen instead
 * of a dead end. */
function notAdmittedFailure(locale: Locale, proposalId: string, err: RelationTypeNotAdmittedError) {
	const msgs = messages(locale);
	// Issue #648: one of the shipped ten reads in the interface language, keyed on the type's
	// own `key` (#196, decision L1), exactly like the card's heading two lines above this
	// notice already does. A universe's own type has no bundle entry, and `typeLabel` is the
	// stored text as authored, which is the right fallback for it.
	const typeLabel = msgs.relationTypeLabel(err.typeKey)?.label ?? err.typeLabel;
	return fail(409, {
		error: msgs.import.review.errors.notAdmitted(
			typeLabel,
			msgs.proposals.diffCard.entityTypeLabel(err.fromType),
			msgs.proposals.diffCard.entityTypeLabel(err.toType)
		),
		notAdmitted: {
			proposalId,
			relationTypeId: err.relationTypeId,
			typeLabel: err.typeLabel,
			typeKey: err.typeKey,
			fromType: err.fromType,
			toType: err.toType,
			addFrom: err.addFrom,
			addTo: err.addTo,
			shipped: err.shipped
		}
	});
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
			// Issue #613: a relation whose entry is still only proposed. The card withholds
			// Accept for exactly this case, so reaching here means a second tab or a stale
			// page posted it; 409 with the sentence that says what to accept first, rather
			// than a 500 on a state the queue is allowed to be in.
			if (err instanceof RelationEndpointNotAcceptedError) {
				return fail(409, { error: t.relationEndpointNotAccepted });
			}
			// Issue #628: #191's admission check is correct, and stopping here used to be
			// the whole answer - the endpoints' real types are only final once the GM has
			// accepted them, so this is the first moment the pair is knowable, and there is
			// nowhere earlier the check could have run instead. What was missing was a
			// route forward: `notAdmittedFailure` carries what `widenRelationType` needs so
			// the card can offer the GM's own consent to widen, in place of a dead end.
			if (err instanceof RelationTypeNotAdmittedError) {
				return notAdmittedFailure(locals.locale, proposalId, err);
			}
			if (err instanceof ProposalNotFoundError || err instanceof ProposalAlreadyDecidedError) {
				return fail(409, { error: err.message });
			}
			throw err;
		}
	},

	/** Issue #628: the GM's consent to two effects at once, in this order - widen the
	 * relation type by exactly what this link needs, then accept the link - which is why
	 * the button that posts this names both.
	 *
	 * Which widening that is comes from the admission check itself, not from the request.
	 * The action re-attempts the plain accept first and reads `addFrom`/`addTo` off the
	 * refusal it gets back, so the arrays can only ever grow by the pair the GM was shown.
	 * Taking them from the form instead would let a hand-built post widen a type by
	 * something nobody reviewed, which is guardrail 1 with extra steps: the consent is to
	 * a specific widening, so the specific widening cannot be the caller's to name. The
	 * first attempt costs one rolled-back transaction and buys that.
	 *
	 * A shipped type is refused rather than widened, the same as anywhere else - the card
	 * never offers the button for one, and a stale page that posts anyway gets the reason
	 * rather than a 500. */
	widenAndAccept: async ({ request, params, locals }) => {
		const { conn, access, detail, userId } = await loadJob(locals, params.universe, params.job);
		const t = messages(locals.locale).import.review.errors;
		const data = await request.formData();
		const proposalId = data.get('proposalId');
		if (typeof proposalId !== 'string') return fail(400, { error: t.missingProposalId });
		const candidate = detail.candidates.find((c) => c.proposal.id === proposalId);
		if (!candidate) return fail(404, { error: t.proposalNotFound(proposalId) });
		const acceptInput = {
			proposalId,
			decidedBy: userId,
			...importAcceptFields(candidate.proposal, detail.job)
		};
		try {
			return { id: (await acceptAnyImportProposal(conn, candidate.proposal.kind, acceptInput)).id };
		} catch (err) {
			if (!(err instanceof RelationTypeNotAdmittedError)) {
				if (err instanceof RelationEndpointNotAcceptedError) {
					return fail(409, { error: t.relationEndpointNotAccepted });
				}
				if (err instanceof ProposalNotFoundError || err instanceof ProposalAlreadyDecidedError) {
					return fail(409, { error: err.message });
				}
				throw err;
			}
			if (err.shipped) return notAdmittedFailure(locals.locale, proposalId, err);
			try {
				await widenRelationType(conn, access.universe.id, err.relationTypeId, {
					...(err.addFrom ? { addFrom: [err.addFrom] } : {}),
					...(err.addTo ? { addTo: [err.addTo] } : {})
				});
				const accepted = await acceptAnyImportProposal(conn, candidate.proposal.kind, acceptInput);
				return { id: accepted.id };
			} catch (widenErr) {
				if (widenErr instanceof RelationTypeNotOwnedError) {
					return fail(409, { error: t.relationTypeNotOwned });
				}
				if (widenErr instanceof RelationTypeNotAdmittedError) {
					return notAdmittedFailure(locals.locale, proposalId, widenErr);
				}
				if (
					widenErr instanceof ProposalNotFoundError ||
					widenErr instanceof ProposalAlreadyDecidedError
				) {
					return fail(409, { error: widenErr.message });
				}
				throw widenErr;
			}
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
