/**
 * Issue #108, D2 = B ("live feed of proposals"): the estimate/consent screen and, once the
 * job is running, the live feed itself with a single inline accept - D7's own mock shows
 * exactly this as onboarding's fourth screen ("First accept"). The full multi-proposal
 * review queue (D4, C6's keyboard queue with type filters) is ReviewSurfaces'
 * /w/[universe]/import/[job]/review, linked to rather than rebuilt here.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { eq, universeAccessBySlug, type UniverseAccess } from '@canonry/db';
import { universe } from '@canonry/db/schema';
import { messages, type Locale } from '$lib/i18n';
import { db } from '$lib/server/db';
import {
	acceptOnboardingProposal,
	evidenceSourcePath,
	getImportJobRow,
	openArtefact,
	proposalsForImportJob,
	type ImportJobRow
} from '$lib/server/onboarding';
import type { Actions, PageServerLoad } from './$types';

async function requireJobAccess(
	userId: string | undefined,
	jobId: string,
	locale: Locale
): Promise<{ job: ImportJobRow; access: UniverseAccess }> {
	if (!userId) redirect(303, '/auth/sign-in');
	const notFound = messages(locale).import.job.errors.jobNotFound;
	const job = await getImportJobRow(db(), jobId);
	if (!job) error(404, notFound);

	const [universeRow] = await db()
		.select()
		.from(universe)
		.where(eq(universe.id, job.universeId))
		.limit(1);
	if (!universeRow) error(404, notFound);
	const access = await universeAccessBySlug(db(), universeRow.slug, userId);
	if (!access) error(404, notFound);
	return { job, access };
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const { job, access } = await requireJobAccess(locals.user?.id, params.job, locals.locale);
	const proposals = await proposalsForImportJob(db(), job.id);

	return {
		job,
		universe: { slug: access.universe.slug, name: access.universe.name },
		proposals
	};
};

export const actions: Actions = {
	accept: async ({ request, params, locals }) => {
		const { job } = await requireJobAccess(locals.user?.id, params.job, locals.locale);
		const data = await request.formData();
		const proposalId = String(data.get('proposalId') ?? '');

		const proposals = await proposalsForImportJob(db(), job.id);
		const target = proposals.find((p) => p.id === proposalId);
		if (!target) {
			return fail(400, { error: messages(locals.locale).import.job.errors.proposalGone });
		}

		const sourcePath = evidenceSourcePath(target.evidence);
		let contentHash = '';
		if (sourcePath) {
			const reader = await openArtefact(job.artefactPath);
			try {
				contentHash = reader.contentHashOf(sourcePath);
			} catch {
				contentHash = '';
			}
		}

		await acceptOnboardingProposal(db(), {
			proposalId,
			decidedBy: locals.user!.id,
			sourceSystem: job.sourceType,
			externalId: null,
			sourceUrl: null,
			contentHash,
			importJobId: job.id
		});

		redirect(303, `/onboarding/import/${job.id}?accepted=${proposalId}`);
	}
};
