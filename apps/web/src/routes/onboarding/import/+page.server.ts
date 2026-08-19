/**
 * Issue #108. Three states on one page, matching the artifacts' own shape:
 * D1 = C ("detect then confirm") for `upload` -> `confirm`, then D2 = B's estimate card
 * ("Import estimate... Start import") for `confirm` -> `start`. Guardrail 1 extended to
 * spend (D2's own doc comment): "the estimate is a consent screen for spending real money
 * and quota... never an auto-start the instant a file lands" - so `confirm` only computes
 * numbers, `start` is the one action that actually admits and runs a job.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { error, fail, redirect } from '@sveltejs/kit';
import { universeAccessBySlug, type UniverseAccess } from '@canonry/db';
import { ArchiveSourceReader, DEFAULT_ARCHIVE_LIMITS } from '@canonry/import';
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
	ImportQuotaExceededError,
	KNOWN_PLAYBOOK_IDS,
	loadBuiltinPlaybook,
	PLAYBOOK_LABELS,
	startImportRun,
	storeUpload,
	tempUploadPath,
	type KnownPlaybookId
} from '$lib/server/onboarding';
import type { Actions, PageServerLoad } from './$types';

// SPEC.md §6.7: "a global concurrency limit" - generous rather than realistic, because no
// queue promoter exists yet anywhere in this codebase (a queued-but-not-admitted job would
// simply sit at 'queued' forever with nothing to advance it later). Onboarding's own load
// is one job at a time by construction, so this only matters if it is set too low for that.
const IMPORT_CONCURRENCY_LIMIT = 20;

async function requireImportAccess(
	userId: string | undefined,
	slug: string,
	locale: Locale
): Promise<UniverseAccess> {
	if (!userId) redirect(303, '/auth/sign-in');
	const access = await universeAccessBySlug(db(), slug, userId);
	if (!access || access.role === 'viewer') {
		error(404, messages(locale).import.upload.errors.universeNotFound(slug));
	}
	return access;
}

function isKnownPlaybookId(value: FormDataEntryValue | null): value is KnownPlaybookId {
	return typeof value === 'string' && (KNOWN_PLAYBOOK_IDS as readonly string[]).includes(value);
}

export const load: PageServerLoad = async ({ url, locals }) => {
	const slug = url.searchParams.get('universe');
	if (!slug) error(400, messages(locals.locale).import.upload.errors.noUniverseGiven);
	const access = await requireImportAccess(locals.user?.id, slug, locals.locale);

	return {
		universe: { slug: access.universe.slug, name: access.universe.name },
		playbookLabels: PLAYBOOK_LABELS,
		playbookIds: KNOWN_PLAYBOOK_IDS,
		fakeDriverSupported: hasLiveGatewayCredentials() ? null : [...FAKE_DRIVER_SUPPORTED_PLAYBOOKS]
	};
};

export const actions: Actions = {
	// D1's first state: drop a file, see what Canonry thinks it is.
	upload: async ({ request, locals }) => {
		const data = await request.formData();
		const slug = String(data.get('universe') ?? '');
		await requireImportAccess(locals.user?.id, slug, locals.locale);
		const t = messages(locals.locale).import.upload.errors;

		const file = data.get('file');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { stage: 'upload' as const, error: t.chooseFile });
		}

		const bytes = new Uint8Array(await file.arrayBuffer());
		let reader: ArchiveSourceReader;
		try {
			reader = ArchiveSourceReader.open(bytes, DEFAULT_ARCHIVE_LIMITS);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return fail(400, {
				stage: 'upload' as const,
				error: t.unreadableFile(file.name, message)
			});
		}

		const detected = await detectSource(reader);
		const { tempId } = await storeUpload(bytes);

		return {
			stage: 'confirm' as const,
			tempId,
			fileName: file.name,
			fileBytes: bytes.byteLength,
			playbookId: detected.playbookId,
			confident: detected.confident,
			detail: detected.detail
		};
	},

	// D1's second state: confirm (or override) the detected playbook. Computes D2's
	// estimate but spends nothing yet - `start` below is the consent click.
	confirm: async ({ request, locals }) => {
		const data = await request.formData();
		const slug = String(data.get('universe') ?? '');
		await requireImportAccess(locals.user?.id, slug, locals.locale);
		const t = messages(locals.locale).import.upload.errors;

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
			detail: null
		};

		if (!hasLiveGatewayCredentials() && !FAKE_DRIVER_SUPPORTED_PLAYBOOKS.has(playbookId)) {
			return fail(400, {
				...reshowConfirm,
				error: t.needsLiveModel(PLAYBOOK_LABELS[playbookId])
			});
		}

		const bytes = await readFile(tempUploadPath(tempId));
		const reader = ArchiveSourceReader.open(bytes, DEFAULT_ARCHIVE_LIMITS);
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
	start: async ({ request, locals }) => {
		const data = await request.formData();
		const slug = String(data.get('universe') ?? '');
		const access = await requireImportAccess(locals.user?.id, slug, locals.locale);
		const t = messages(locals.locale).import.upload.errors;

		const tempId = String(data.get('tempId') ?? '');
		const playbookIdRaw = data.get('playbookId');
		if (!tempId || !isKnownPlaybookId(playbookIdRaw)) {
			return fail(400, { stage: 'upload' as const, error: t.lostUpload });
		}
		const playbookId = playbookIdRaw;

		const bytes = await readFile(tempUploadPath(tempId));
		const reader = ArchiveSourceReader.open(bytes, DEFAULT_ARCHIVE_LIMITS);
		const documents = await documentsForPlaybook(playbookId, reader);
		const playbook = await loadBuiltinPlaybook(playbookId);
		const averages = await estimateAveragesFor(db(), playbookId);
		const { estimate, budgetCredits } = deriveJobBudget(averages, documents.length);

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
				locale: locals.locale
			});
		}

		redirect(303, `/onboarding/import/${admission.jobId}`);
	}
};
