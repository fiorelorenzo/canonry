/**
 * Issue R11, round thirteen (docs/design/DECISIONS.md): `/w/[universe]/import`, the door for
 * a world that already exists. Issue #790 rebuilt the flow file-first: drop or pick a file,
 * detection and the estimate both run right away, one preview screen shows what was found
 * and what starting it would cost, and "Start import" is the only button that spends
 * anything. `/onboarding/import` still runs its own upload -> confirm -> estimate steps for
 * a universe being created and was left alone (out of #790's scope) - this route diverged
 * from it here, though both still call the same `$lib/server/onboarding` helpers rather than
 * a second uploader, and both still read `import.upload.*`/`import.existing.*` for the parts
 * that stayed identical (the accepted-format copy, the no-live-model notice).
 *
 * `packages/import` exposes `startJob`/`cancel` on its `ImportDriver` seam and nothing
 * outside that package may learn which driver answers them (AGENTS.md) - this file
 * never touches `ImportDriver` itself, only `startImportRun`/`admitAndCreateImportJob`,
 * the same boundary onboarding's own page already respects. The one other thing this file
 * reads off `@canonry/import` directly is `SourceReader`, `ArchiveSourceReader` and the
 * upload-format constants - all part of that package's public surface already, none of
 * them the driver seam.
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
	UPLOAD_ACCEPT_ATTRIBUTE,
	type SourceReader
} from '@canonry/import';
import { messages, type DetectedDetail, type DetectedNotice, type Locale } from '$lib/i18n';
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
 * Guards every action below, defence in depth behind the drop zone the page itself
 * hides from a viewer (`data.canStart`). */
function requireWriteAccess(access: UniverseAccess, locale: Locale): void {
	if (access.role === 'viewer') {
		error(403, messages(locale).import.existing.viewerNotice);
	}
}

function isKnownPlaybookId(value: FormDataEntryValue | null): value is KnownPlaybookId {
	return typeof value === 'string' && (KNOWN_PLAYBOOK_IDS as readonly string[]).includes(value);
}

/** Why the preview's "Start import" button is disabled - checked again in `start` below
 * rather than trusted from the client, the same defence in depth `requireWriteAccess`
 * already is. `null` means nothing is blocking it. */
type PreviewBlockedReason = 'no_documents' | 'needs_live_model';

function previewBlockedReason(
	playbookId: KnownPlaybookId,
	documentCount: number
): PreviewBlockedReason | null {
	if (documentCount === 0) return 'no_documents';
	if (!hasLiveGatewayCredentials() && !FAKE_DRIVER_SUPPORTED_PLAYBOOKS.has(playbookId)) {
		return 'needs_live_model';
	}
	return null;
}

async function estimateFor(playbookId: KnownPlaybookId, documentCount: number) {
	const averages = await estimateAveragesFor(db(), playbookId);
	return deriveJobBudget(averages, documentCount).estimate;
}

/** Issue #790: the one preview screen between "here is a file" and "this spent a
 * credit" - detection and the estimate both run off the same reader, before anything
 * touches an `import_job` row, so overriding the detected playbook (the `confirm`
 * action below) recomputes this and nothing else. */
async function computePreview(input: {
	tempId: string;
	fileName: string;
	fileBytes: number;
	playbookId: KnownPlaybookId;
	confident: boolean;
	detail: DetectedDetail | null;
	notices: DetectedNotice[];
	reader: SourceReader;
}) {
	const documents = await documentsForPlaybook(input.playbookId, input.reader);
	const estimate = await estimateFor(input.playbookId, documents.length);
	return {
		stage: 'preview' as const,
		tempId: input.tempId,
		fileName: input.fileName,
		fileBytes: input.fileBytes,
		playbookId: input.playbookId,
		confident: input.confident,
		detail: input.detail,
		notices: input.notices,
		documentCount: documents.length,
		estimatedMinutes: estimate.estimatedMinutes,
		estimatedCredits: estimate.estimatedCredits,
		blocked: previewBlockedReason(input.playbookId, documents.length)
	};
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
			// against the same label map the preview's playbook select uses rather than
			// indexing `PLAYBOOK_LABELS` with a wider `string` on the client.
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
	// Drop or pick a file: sniff it, detect its format, compute the preview - all in one
	// round trip, none of it spending anything (issue #790).
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

		return await computePreview({
			tempId,
			fileName: file.name,
			fileBytes: bytes.byteLength,
			playbookId: detected.playbookId,
			confident: detected.confident,
			detail: detected.detail,
			notices: detected.notices,
			reader
		});
	},

	// The preview's playbook override: re-detection was never confident, or the GM knows
	// better. Recomputes the same preview for the playbook chosen instead - nothing here
	// spends anything either.
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

		const { reader } = await openStoredUpload(tempId);
		return await computePreview({
			tempId,
			fileName,
			fileBytes,
			playbookId: playbookIdRaw,
			confident: true,
			detail: null,
			notices: [],
			reader
		});
	},

	// The preview's one explicit confirm: the only action that actually spends anything.
	start: async ({ request, params, locals }) => {
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

		const { bytes, reader } = await openStoredUpload(tempId);
		const documents = await documentsForPlaybook(playbookId, reader);

		const blocked = previewBlockedReason(playbookId, documents.length);
		if (blocked) {
			const estimate = await estimateFor(playbookId, documents.length);
			return fail(400, {
				stage: 'preview' as const,
				tempId,
				fileName,
				fileBytes,
				playbookId,
				confident: true,
				detail: null,
				notices: [],
				documentCount: documents.length,
				estimatedMinutes: estimate.estimatedMinutes,
				estimatedCredits: estimate.estimatedCredits,
				blocked,
				error:
					blocked === 'no_documents'
						? t.noDocumentsFound
						: t.needsLiveModel(PLAYBOOK_LABELS[playbookId])
			});
		}

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
					stage: 'preview' as const,
					tempId,
					fileName,
					fileBytes,
					playbookId,
					confident: true,
					detail: null,
					notices: [],
					documentCount: documents.length,
					estimatedMinutes: estimate.estimatedMinutes,
					estimatedCredits: estimate.estimatedCredits,
					blocked: null,
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
