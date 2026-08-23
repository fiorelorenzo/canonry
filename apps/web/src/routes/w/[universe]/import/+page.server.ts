/**
 * Issue R11, round thirteen (docs/ux/DECISIONS.md): `/w/[universe]/import`, the door for
 * a world that already exists. `/onboarding/import` runs the identical D1/D2 flow
 * (upload -> confirm -> estimate -> start) for a universe being created; this route
 * reuses the same server helpers (`$lib/server/onboarding`) rather than a second
 * uploader, scoped to `params.universe` instead of a query-string universe, and adds the
 * one thing onboarding's own page has no use for: the jobs this universe has already
 * run, each with its status and its review link (`/w/[universe]/import/[job]/review`,
 * already built).
 *
 * `packages/import` exposes `startJob`/`cancel` on its `ImportDriver` seam and nothing
 * outside that package may learn which driver answers them (AGENTS.md) - this file
 * never touches `ImportDriver` itself, only `startImportRun`/`admitAndCreateImportJob`,
 * the same boundary onboarding's own page already respects.
 *
 * Role: any member may load this page - a viewer sees the job list read-only, same as
 * every other `/w/` route. Starting a job is an editor/owner action, guarded in every
 * action below the way `works/+page.server.ts`'s `create` action guards a viewer.
 */
import { createHash } from 'node:crypto';
import { error, fail, redirect } from '@sveltejs/kit';
import { importJobsForUniverse, universeAccessBySlug, type UniverseAccess } from '@canonry/db';
import {
	ArchiveSourceReader,
	DEFAULT_ARCHIVE_LIMITS,
	UPLOAD_ACCEPT_ATTRIBUTE
} from '@canonry/import';
import { messages, type Locale } from '$lib/i18n';
import { db } from '$lib/server/db';
import {
	admitAndCreateImportJob,
	deriveJobBudget,
	detectSource,
	documentsForPlaybook,
	estimateAveragesFor,
	FAKE_DRIVER_SUPPORTED_PLAYBOOKS,
	hasLiveGatewayCredentials,
	IMPORT_CONCURRENCY_LIMIT,
	ImportQuotaExceededError,
	KNOWN_PLAYBOOK_IDS,
	loadBuiltinPlaybook,
	openStoredUpload,
	PLAYBOOK_LABELS,
	refuseUnreadableUpload,
	startImportRun,
	storeUpload,
	tempUploadPath,
	type KnownPlaybookId
} from '$lib/server/onboarding';
import type { Actions, PageServerLoad } from './$types';

async function requireMembership(
	userId: string | undefined,
	slug: string
): Promise<UniverseAccess> {
	if (!userId) error(404, `No universe named "${slug}"`);
	const access = await universeAccessBySlug(db(), slug, userId);
	if (!access) error(404, `No universe named "${slug}"`);
	return access;
}

/** The write half of role gating: a viewer may load this page but never start a job.
 * Guards every action below, defence in depth behind the upload form the page itself
 * hides from a viewer (`data.canStart`). */
function requireWriteAccess(access: UniverseAccess, locale: Locale): void {
	if (access.role === 'viewer') {
		error(403, messages(locale).import.existing.viewerNotice);
	}
}

function isKnownPlaybookId(value: FormDataEntryValue | null): value is KnownPlaybookId {
	return typeof value === 'string' && (KNOWN_PLAYBOOK_IDS as readonly string[]).includes(value);
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const access = await requireMembership(locals.user?.id, params.universe);
	const jobs = await importJobsForUniverse(db(), access.universe.id);

	return {
		universe: { slug: access.universe.slug, name: access.universe.name },
		canStart: access.role !== 'viewer',
		playbookLabels: PLAYBOOK_LABELS,
		playbookIds: KNOWN_PLAYBOOK_IDS,
		// Issue #615: the same one definition the onboarding screen reads, for the same
		// reason. Two copies of this list in two Svelte files is what let the picker refuse
		// a `.onepkg` the product had a reader for.
		uploadAccept: UPLOAD_ACCEPT_ATTRIBUTE,
		fakeDriverSupported: hasLiveGatewayCredentials() ? null : [...FAKE_DRIVER_SUPPORTED_PLAYBOOKS],
		jobs: jobs.map((job) => ({
			id: job.id,
			// A job's `source_type` is always written from `KNOWN_PLAYBOOK_IDS` by the
			// `start` action below, but the column itself is a plain string - resolved
			// against the same label map the confirm dropdown uses rather than indexing
			// `PLAYBOOK_LABELS` with a wider `string` on the client.
			playbookLabel: isKnownPlaybookId(job.sourceType)
				? PLAYBOOK_LABELS[job.sourceType]
				: job.sourceType,
			status: job.status,
			documentCount: job.documentCount,
			proposalsEmitted: job.proposalsEmitted,
			createdAt: job.createdAt
		}))
	};
};

export const actions: Actions = {
	// D1's first state: drop a file, see what Canonry thinks it is.
	upload: async ({ request, params, locals }) => {
		const access = await requireMembership(locals.user?.id, params.universe);
		requireWriteAccess(access, locals.locale);
		const t = messages(locals.locale).import.upload.errors;

		const data = await request.formData();
		const file = data.get('file');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { stage: 'upload' as const, error: t.chooseFile });
		}

		const bytes = new Uint8Array(await file.arrayBuffer());
		let reader: ArchiveSourceReader;
		try {
			reader = ArchiveSourceReader.openUpload(bytes, file.name, DEFAULT_ARCHIVE_LIMITS);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return fail(400, { stage: 'upload' as const, error: t.unreadableFile(file.name, message) });
		}

		// Issue #591: refused here, where no `tempId` exists yet, so there is no path from
		// this upload to an `import_job` row and no credit can be spent on a format nobody
		// wrote a reader for.
		const refusal = await refuseUnreadableUpload(reader);
		if (refusal) {
			return fail(400, {
				stage: 'upload' as const,
				error: t.unreadableFormat(refusal.format, refusal.path)
			});
		}

		const detected = await detectSource(reader);
		const { tempId } = await storeUpload(bytes, file.name);

		return {
			stage: 'confirm' as const,
			tempId,
			fileName: file.name,
			fileBytes: bytes.byteLength,
			playbookId: detected.playbookId,
			confident: detected.confident,
			detail: detected.detail,
			notices: detected.notices
		};
	},

	// D1's second state: confirm (or override) the detected playbook. Computes D2's
	// estimate but spends nothing yet - `start` below is the consent click.
	confirm: async ({ request, params, locals }) => {
		const access = await requireMembership(locals.user?.id, params.universe);
		requireWriteAccess(access, locals.locale);
		const t = messages(locals.locale).import.upload.errors;

		const data = await request.formData();
		const tempId = String(data.get('tempId') ?? '');
		const playbookIdRaw = data.get('playbookId');
		const fileName = String(data.get('fileName') ?? 'upload');
		const fileBytes = Number(data.get('fileBytes') ?? 0);
		if (!tempId || !isKnownPlaybookId(playbookIdRaw)) {
			return fail(400, { stage: 'upload' as const, error: t.lostUpload });
		}
		const playbookId = playbookIdRaw;
		const reshowConfirm = {
			stage: 'confirm' as const,
			tempId,
			fileName,
			fileBytes,
			playbookId,
			confident: true,
			detail: null,
			notices: []
		};

		if (!hasLiveGatewayCredentials() && !FAKE_DRIVER_SUPPORTED_PLAYBOOKS.has(playbookId)) {
			return fail(400, {
				...reshowConfirm,
				error: t.needsLiveModel(PLAYBOOK_LABELS[playbookId])
			});
		}

		const { reader } = await openStoredUpload(tempId);
		const documents = await documentsForPlaybook(playbookId, reader);
		if (documents.length === 0) {
			return fail(400, {
				...reshowConfirm,
				error: t.noDocumentsFound
			});
		}
		const averages = await estimateAveragesFor(db(), playbookId);
		const estimate = deriveJobBudget(averages, documents.length).estimate;

		return {
			stage: 'estimate' as const,
			tempId,
			fileName,
			fileBytes,
			playbookId,
			documentCount: documents.length,
			estimatedMinutes: estimate.estimatedMinutes,
			estimatedCredits: estimate.estimatedCredits
		};
	},

	// D2's consent click: this is the one action that actually spends anything.
	start: async ({ request, params, locals }) => {
		const access = await requireMembership(locals.user?.id, params.universe);
		requireWriteAccess(access, locals.locale);
		const t = messages(locals.locale).import.upload.errors;

		const data = await request.formData();
		const tempId = String(data.get('tempId') ?? '');
		const playbookIdRaw = data.get('playbookId');
		if (!tempId || !isKnownPlaybookId(playbookIdRaw)) {
			return fail(400, { stage: 'upload' as const, error: t.lostUpload });
		}
		const playbookId = playbookIdRaw;

		const { bytes, reader } = await openStoredUpload(tempId);
		const documents = await documentsForPlaybook(playbookId, reader);
		const playbook = await loadBuiltinPlaybook(playbookId);
		const averages = await estimateAveragesFor(db(), playbookId);
		const { estimate, budgetCredits, timeoutMs } = deriveJobBudget(averages, documents.length);

		let admission;
		try {
			admission = await admitAndCreateImportJob(db(), {
				universeId: access.universe.id,
				createdBy: locals.user!.id,
				sourceType: playbookId,
				playbook: playbook.id,
				playbookVersion: playbook.version,
				artefactPath: tempUploadPath(tempId),
				artefactBytes: bytes.byteLength,
				artefactSha256: createHash('sha256').update(bytes).digest('hex'),
				documentCount: documents.length,
				budgetCredits,
				estimate,
				concurrencyLimit: IMPORT_CONCURRENCY_LIMIT
			});
		} catch (err) {
			if (err instanceof ImportQuotaExceededError) {
				const refused =
					err.reason === 'jobs_quota'
						? t.refused.jobsQuota
						: err.reason === 'documents_quota'
							? t.refused.documentsQuota
							: t.refused.insufficientCredits;
				return fail(400, {
					stage: 'estimate' as const,
					tempId,
					fileName: String(data.get('fileName') ?? 'upload'),
					fileBytes: Number(data.get('fileBytes') ?? 0),
					playbookId,
					documentCount: documents.length,
					estimatedMinutes: estimate.estimatedMinutes,
					estimatedCredits: estimate.estimatedCredits,
					error: refused
				});
			}
			throw err;
		}

		if (admission.admitted) {
			startImportRun(db(), {
				dbJobId: admission.jobId,
				universeId: access.universe.id,
				sourceSystem: playbookId,
				userId: locals.user!.id,
				playbook,
				documents,
				artefactPath: tempUploadPath(tempId),
				budgetCredits,
				timeoutMs,
				locale: locals.locale
			});
		}

		redirect(303, `/w/${params.universe}/import/${admission.jobId}/review`);
	}
};
