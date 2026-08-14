/**
 * #47/#51: the inbox, C2 = A. Propagation plans and import jobs that still carry a pending
 * proposal, each its own row - never merged into one list, since D4's hundreds and C3's
 * tens need separate reviewers (docs/ux/c2-proposal-routing.html).
 */
import { error } from '@sveltejs/kit';
import { universeAccessBySlug } from '@canonry/db';
import { db } from '$lib/server/db';
import { propagationPlansForInbox, importJobsForInbox } from '$lib/server/proposals';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) error(404, `No universe named "${params.universe}"`);
	const conn = db();
	const access = await universeAccessBySlug(conn, params.universe, locals.user.id);
	if (!access) error(404, `No universe named "${params.universe}"`);

	const [plans, jobs] = await Promise.all([
		propagationPlansForInbox(conn, access.universe.id),
		importJobsForInbox(conn, access.universe.id)
	]);

	return {
		universe: { slug: access.universe.slug, name: access.universe.name },
		plans: plans.map((p) => ({
			id: p.plan.id,
			triggerEntityName: p.triggerEntityName,
			trigger: p.plan.trigger,
			pending: p.pending,
			accepted: p.accepted,
			rejected: p.rejected,
			total: p.total,
			createdAt: p.plan.createdAt
		})),
		importJobs: jobs.map((j) => ({
			id: j.job.id,
			playbook: j.job.playbook,
			pending: j.pending,
			accepted: j.accepted,
			rejected: j.rejected,
			total: j.total,
			createdAt: j.job.createdAt
		}))
	};
};
