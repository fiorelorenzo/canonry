/**
 * Issue #80, guardrail 1 at the table: "a quick note taken at the table becomes a
 * proposal, never a direct write, and it is marked as one." No model involved - capture is
 * a deterministic append onto the target entity's current body, computed once here and
 * stored as the proposal's full `after` text, the same "diff computed once, applied exactly
 * as shown on accept" shape every other proposal in this product already uses. Per decision
 * G8 = B, table mode never surfaces this for review while the session is open; it lands in
 * the ordinary proposal inbox, silent until the GM leaves the table (SPEC.md §8, "notes
 * taken during play turn into entry proposals after the session, not during it").
 */
import { error, json } from '@sveltejs/kit';
import { createProposalPlan, recordProposalDiff, runningSessionContext } from '@canonry/db';
import { db } from '$lib/server/db';
import { publishTableEvent } from '$lib/server/table-stream';
import { requireTableAccess } from '../_server/guard.js';
import type { RequestHandler } from './$types';

interface NoteBody {
	targetEntityId?: string;
	note?: string;
}

function isNoteBody(value: unknown): value is NoteBody {
	return typeof value === 'object' && value !== null;
}

export const POST: RequestHandler = async (event) => {
	const access = await requireTableAccess(event);
	const raw: unknown = await event.request.json().catch(() => ({}));
	const body = isNoteBody(raw) ? raw : {};

	const note = (body.note ?? '').trim();
	const targetEntityId = body.targetEntityId;
	if (!note) error(400, 'the note is empty');
	if (!targetEntityId) error(400, 'pick which entry this note is about');

	const conn = db();
	const target = await conn.query.entity.findFirst({
		where: (entity, { and, eq }) =>
			and(eq(entity.id, targetEntityId), eq(entity.universeId, access.universe.id)),
		columns: { id: true, name: true, body: true }
	});
	if (!target) error(404, 'that entry does not exist in this universe');

	const context = await runningSessionContext(conn, access.universe.id);
	const when = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
	const afterBody =
		target.body.length > 0
			? `${target.body}\n\n**Table note, ${when}:** ${note}`
			: `**Table note, ${when}:** ${note}`;

	const { proposals } = await createProposalPlan(conn, {
		universeId: access.universe.id,
		trigger: 'table',
		triggerEntityId: target.id,
		summary: `A quick table note about ${target.name}`,
		candidateCap: 1,
		estimatedCredits: 0,
		candidates: [
			{
				kind: 'update',
				targetEntityId: target.id,
				rationale: `Captured as a quick note at the table${context?.placeEntityId ? ' while a place was declared' : ''}. Never applied directly - review it like any other proposal.`,
				evidence: {
					source: 'table-quick-note',
					sessionContextId: context?.id ?? null,
					note,
					capturedAt: new Date().toISOString()
				},
				rank: 0
			}
		]
	});
	const created = proposals[0];
	if (!created) error(500, 'could not create the note proposal');

	const proposal = await recordProposalDiff(conn, {
		proposalId: created.id,
		patch: { summary: `Table note: ${note.slice(0, 80)}`, before: target.body, after: afterBody },
		provider: 'canonry-table',
		modelId: 'none (verbatim capture)',
		credits: 0
	});

	publishTableEvent(access.universe.id, 'proposal', {
		proposalId: proposal.id,
		kind: proposal.kind,
		targetEntityId: target.id,
		targetName: target.name,
		preview: note.slice(0, 120),
		via: 'quick note'
	});

	return json({ ok: true, proposal });
};
