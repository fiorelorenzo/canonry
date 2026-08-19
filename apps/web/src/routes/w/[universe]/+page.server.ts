/**
 * `/w/[universe]`: the world home, decision O1 = C (#283), which amends I7 = C. This route
 * used to be the entry browser with a collapsible overview strip above it; the browser now
 * lives at `/w/[universe]/entries` and this page is a home in its own right: a masthead,
 * Continue, Waiting for you, Recent activity.
 *
 * Three numbers, no fourth query. The masthead's entry count and pending-review count come
 * from the layout's own `navCounts` (`w/[universe]/+layout.server.ts`, which the sidebar
 * badge already needs on every route under a universe) and the quota from the root layout's
 * `shellQuota` (issue #150's meter, already computed once per navigation). The strip used to
 * call `entityCountsByType`, `pendingProposalCount` and `billingSummaryFor` a second time
 * each for exactly those figures.
 *
 * "Waiting for you" is a pointer and nothing else: `propagationPlansForInbox` and
 * `importJobsForInbox` are the inbox's own two reads (`w/[universe]/proposals`), so the home
 * shows the same rows the inbox does and links into it. C2 = A decided the inbox is where a
 * proposal is reviewed, and guardrail 1 gets no second accept surface because this page is
 * prettier.
 */
import { error } from '@sveltejs/kit';
import { listEntitiesForUniverse, recentActivity } from '@canonry/db';
import { db } from '$lib/server/db';
import { stripMentionSyntax } from '$lib/markdown';
import { importJobsForInbox, propagationPlansForInbox } from '$lib/server/proposals';
import type { PageServerLoad } from './$types';

/** Enough to fill the row on a wide screen and scroll on a narrow one, which is what a
 * "Continue" row is for: the last few entries touched, not a second browser. */
const CONTINUE_LIMIT = 6;

/** The feed is a glance, not a log. Anything longer belongs to a history surface that does
 * not exist yet, and padding this to fill the screen would push Continue off it. */
const ACTIVITY_LIMIT = 8;

/** Waiting for you shows the newest few and then says how many there are in total, rather
 * than growing without a bound on the one section that must stay quiet (C2 = A). */
const WAITING_LIMIT = 3;

export const load: PageServerLoad = async ({ parent, locals }) => {
	const { current } = await parent();
	if (!locals.user) error(404, `no universe called "${current.slug}"`);
	const database = db();

	const [continueRows, plans, jobs, activity] = await Promise.all([
		listEntitiesForUniverse(database, current.id, { limit: CONTINUE_LIMIT }),
		propagationPlansForInbox(database, current.id),
		importJobsForInbox(database, current.id),
		recentActivity(database, current.id, { limit: ACTIVITY_LIMIT, locale: locals.locale })
	]);

	return {
		continueEntries: continueRows.map((row) => ({
			id: row.id,
			name: row.name,
			type: row.type,
			slug: row.slug,
			excerpt: stripMentionSyntax(row.excerpt),
			updatedAt: row.updatedAt,
			coverAssetId: row.coverAssetId
		})),
		waiting: {
			plans: plans.slice(0, WAITING_LIMIT).map((p) => ({
				id: p.plan.id,
				triggerEntityName: p.triggerEntityName,
				trigger: p.plan.trigger,
				pending: p.pending
			})),
			importJobs: jobs.slice(0, WAITING_LIMIT).map((j) => ({
				id: j.job.id,
				playbook: j.job.playbook,
				pending: j.pending
			})),
			// Across every plan and job, not only the ones shown above.
			totalPending:
				plans.reduce((sum, p) => sum + p.pending, 0) + jobs.reduce((sum, j) => sum + j.pending, 0)
		},
		activity
	};
};
