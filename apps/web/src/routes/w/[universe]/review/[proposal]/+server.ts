/**
 * Issue #345: the write seam every in-place review surface uses, so reviewing a proposal
 * where it was born needs no per-page copy of the four form actions the plan screen has.
 *
 * The proposal id is in the path, and that is the guardrail-1 statement this file makes
 * structurally rather than by validation: one request decides exactly one proposal, there
 * is no array parameter to widen, no `all` verb to add, and a caller that wants to accept
 * two proposals has to make two requests and read two diffs to get there. Accept still
 * goes through `@canonry/db`'s `acceptProposal`, the single place a proposal's content
 * reaches canon, so nothing here is a second accept path either.
 *
 * `GET` exists for a surface that knows a proposal id and nothing else (Ask's drafted
 * card): it returns the same enriched candidate the queue renders, so what a GM reads
 * before accepting inline is byte-for-byte what the inbox would have shown them.
 */
import { error, json } from '@sveltejs/kit';
import { universeAccessBySlug } from '@canonry/db';
import { messages } from '$lib/i18n';
import { db } from '$lib/server/db';
import {
	acceptProposal,
	rejectProposal,
	reviewableProposalById,
	setRejectReason,
	undoAcceptedProposal,
	ProposalAlreadyDecidedError,
	ProposalCannotBeAcceptedError,
	ProposalNotAcceptedError,
	ProposalNotFoundError,
	UndoNotPossibleError
} from '$lib/server/proposals';
import type { RequestHandler } from './$types';

const ACTIONS = ['accept', 'reject', 'reason', 'undo'] as const;
type Action = (typeof ACTIONS)[number];

function isAction(value: unknown): value is Action {
	return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}

async function requireUniverse(locals: App.Locals, universeSlug: string) {
	const t = messages(locals.locale);
	if (!locals.user) error(404, t.entry.errors.universeNotFound(universeSlug));
	const conn = db();
	const access = await universeAccessBySlug(conn, universeSlug, locals.user.id);
	if (!access) error(404, t.entry.errors.universeNotFound(universeSlug));
	return { conn, access, userId: locals.user.id, t };
}

export const GET: RequestHandler = async ({ params, locals }) => {
	const { conn, access, t } = await requireUniverse(locals, params.universe);
	const candidate = await reviewableProposalById(conn, access.universe.id, params.proposal);
	if (!candidate) error(404, t.proposals.errors.proposalNotFound);
	return json({ candidate });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { conn, access, userId, t } = await requireUniverse(locals, params.universe);
	if (access.role === 'viewer') error(403, t.proposals.errors.viewerCannotDecide);

	const raw: unknown = await request.json().catch(() => null);
	const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
	if (!isAction(body.action)) error(400, t.proposals.errors.unknownAction);

	// Universe-scoped before anything is written: `acceptProposal` takes an id and would
	// happily apply a proposal belonging to a universe this session cannot see.
	const candidate = await reviewableProposalById(conn, access.universe.id, params.proposal);
	if (!candidate) error(404, t.proposals.errors.proposalNotFound);

	try {
		switch (body.action) {
			case 'accept': {
				const accepted = await acceptProposal(conn, {
					proposalId: params.proposal,
					decidedBy: userId
				});
				return json({ id: accepted.id, outcome: accepted.outcome });
			}
			case 'reject': {
				const rejected = await rejectProposal(conn, {
					proposalId: params.proposal,
					reason: null,
					decidedBy: userId
				});
				return json({ id: rejected.id, outcome: rejected.outcome });
			}
			case 'reason': {
				const reason = body.reason;
				if (typeof reason !== 'string' || reason.length === 0) {
					error(400, t.proposals.errors.missingRejectReason);
				}
				const updated = await setRejectReason(conn, params.proposal, reason);
				if (!updated) error(409, t.proposals.errors.notRejected);
				return json({ id: updated.id, reason: updated.rejectReason });
			}
			case 'undo': {
				const undone = await undoAcceptedProposal(conn, { proposalId: params.proposal });
				return json({ id: undone.id, outcome: undone.outcome });
			}
		}
	} catch (err) {
		if (err instanceof ProposalNotFoundError) error(404, err.message);
		if (
			err instanceof ProposalAlreadyDecidedError ||
			err instanceof ProposalCannotBeAcceptedError ||
			err instanceof ProposalNotAcceptedError ||
			err instanceof UndoNotPossibleError
		) {
			error(409, err.message);
		}
		throw err;
	}
};
