/**
 * D2 = B's live feed, polled from the client rather than pushed over SSE - the job itself
 * runs server-side independent of this request (issue #26), so a client that polls, loses
 * its connection, and polls again never misses anything: it just re-reads whatever
 * import_job.checkpoint and proposal already hold.
 */
import { error, json } from '@sveltejs/kit';
import { eq, universeAccessBySlug } from '@canonry/db';
import { universe } from '@canonry/db/schema';
import { db } from '$lib/server/db';
import { getImportJobRow, proposalsForImportJob } from '$lib/server/onboarding';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'sign in required');

	const job = await getImportJobRow(db(), params.job);
	if (!job) error(404, 'no such import job');

	const [universeRow] = await db()
		.select()
		.from(universe)
		.where(eq(universe.id, job.universeId))
		.limit(1);
	if (!universeRow) error(404, 'no such import job');
	const access = await universeAccessBySlug(db(), universeRow.slug, locals.user.id);
	if (!access) error(404, 'no such import job');

	const proposals = await proposalsForImportJob(db(), job.id);
	return json({
		job: {
			id: job.id,
			status: job.status,
			documentCount: job.documentCount,
			proposalsEmitted: job.proposalsEmitted,
			outcomeNote: job.outcomeNote,
			createdAt: job.createdAt,
			startedAt: job.startedAt,
			finishedAt: job.finishedAt
		},
		proposals: proposals.map((p) => ({
			id: p.id,
			kind: p.kind,
			patch: p.patch,
			rationale: p.rationale,
			outcome: p.outcome,
			decidedAt: p.decidedAt,
			createdAt: p.createdAt
		}))
	});
};
