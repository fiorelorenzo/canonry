/**
 * Issue R11, round thirteen: `/w/[universe]/import`, the door for a world that already
 * exists. Proof that the index reads this universe's real `import_job` rows (not only
 * that the page renders), that a viewer sees the same list read-only, and that a
 * non-member gets the same 404 as every other `/w/` route - the check nobody ran, per
 * the issue's own "How to verify". Same real-Postgres, real-handler convention as
 * `players/players.test.ts` next door and `admin/models/aspect-ratio-guard.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { closeDb, createDb, eq, type Db } from '@canonry/db';
import { importJob, universe, universeMember, user } from '@canonry/db/schema';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actions, load } from './+page.server.js';

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';
process.env.DATABASE_URL ??= DATABASE_URL;

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

async function statusOf(promise: Promise<unknown>): Promise<number> {
	try {
		await promise;
	} catch (err) {
		if (isHttpError(err)) return err.status;
		throw err;
	}
	throw new Error('expected the call to throw an HTTP error, but it returned a value');
}

describe('/w/[universe]/import (issue R11, round thirteen)', () => {
	let db: Db;
	let ownerId: string;
	let viewerId: string;
	let outsiderId: string;
	let universeSlug: string;

	beforeAll(async () => {
		db = createDb(DATABASE_URL, { max: 3 });

		const ownerKey = unique('import-owner');
		const viewerKey = unique('import-viewer');
		const outsiderKey = unique('import-outsider');
		const [owner, viewer, outsider] = await db
			.insert(user)
			.values([
				{ id: ownerKey, name: 'Import Owner', email: `${ownerKey}@example.test` },
				{ id: viewerKey, name: 'Import Viewer', email: `${viewerKey}@example.test` },
				{ id: outsiderKey, name: 'Import Outsider', email: `${outsiderKey}@example.test` }
			])
			.returning({ id: user.id });
		if (!owner || !viewer || !outsider) throw new Error('user insert did not return three rows');
		ownerId = owner.id;
		viewerId = viewer.id;
		outsiderId = outsider.id;

		const [uni] = await db
			.insert(universe)
			.values({
				ownerUserId: ownerId,
				name: 'Import Universe',
				slug: unique('import-universe'),
				kind: 'homebrew'
			})
			.returning({ id: universe.id, slug: universe.slug });
		if (!uni) throw new Error('universe insert did not return a row');
		universeSlug = uni.slug;

		await db
			.insert(universeMember)
			.values({ universeId: uni.id, userId: viewerId, role: 'viewer' });

		// A finished job this universe has already run - `importJobsForUniverse`'s own
		// row, inserted directly rather than through a real upload so this file never has
		// to fabricate an archive.
		await db.insert(importJob).values({
			universeId: uni.id,
			createdBy: ownerId,
			sourceType: 'kanka',
			playbook: 'kanka',
			playbookVersion: 1,
			artefactPath: '/dev/null',
			artefactSha256: 'deadbeef',
			documentCount: 3,
			proposalsEmitted: 7,
			status: 'finished'
		});
	});

	afterAll(async () => {
		await closeDb(db);
	});

	async function loadAs(userId: string) {
		return load({
			params: { universe: universeSlug },
			locals: { user: { id: userId }, locale: 'en' }
		} as Parameters<typeof load>[0]);
	}

	it("lists a universe's past jobs with a resolved playbook label, for a member who can start another", async () => {
		const data = (await loadAs(ownerId)) as {
			canStart: boolean;
			jobs: Array<{
				playbookLabel: string;
				status: string;
				documentCount: number;
				proposalsEmitted: number;
			}>;
		};
		expect(data.canStart).toBe(true);
		expect(data.jobs).toHaveLength(1);
		expect(data.jobs[0]?.status).toBe('finished');
		expect(data.jobs[0]?.documentCount).toBe(3);
		expect(data.jobs[0]?.proposalsEmitted).toBe(7);
		// Resolved against the label map, not the raw `source_type` column value.
		expect(data.jobs[0]?.playbookLabel).not.toBe('kanka');
	});

	it('shows a viewer the same jobs read-only, with no way to start another', async () => {
		const data = (await loadAs(viewerId)) as { canStart: boolean; jobs: unknown[] };
		expect(data.canStart).toBe(false);
		expect(data.jobs).toHaveLength(1);
	});

	it('refuses a non-member the same 404 as any other /w/ route', async () => {
		expect(await statusOf(loadAs(outsiderId))).toBe(404);
	});

	it("refuses a viewer's attempt to start an import", async () => {
		const formData = new FormData();
		formData.set('file', new File([], 'empty.zip'));
		const event = {
			request: new Request('http://localhost/w/x/import', { method: 'POST', body: formData }),
			params: { universe: universeSlug },
			locals: { user: { id: viewerId }, locale: 'en' }
		} as Parameters<typeof actions.upload>[0];

		expect(await statusOf(Promise.resolve(actions.upload(event)))).toBe(403);
	});
});

describe('the file-first upload -> preview -> start flow (issue #790)', () => {
	let flowDb: Db;
	let flowOwnerId: string;
	let flowUniverseSlug: string;
	// `Uint8Array<ArrayBuffer>`, not bare `Uint8Array`: `File`'s BlobPart wants a view over a
	// real ArrayBuffer, and the copying constructor below guarantees one.
	let fixtureBytes: Uint8Array<ArrayBuffer>;

	beforeAll(async () => {
		flowDb = createDb(DATABASE_URL, { max: 3 });

		const ownerKey = unique('import790-owner');
		const [owner] = await flowDb
			.insert(user)
			.values([{ id: ownerKey, name: 'Import790 Owner', email: `${ownerKey}@example.test` }])
			.returning({ id: user.id });
		if (!owner) throw new Error('user insert did not return a row');
		flowOwnerId = owner.id;

		const [uni] = await flowDb
			.insert(universe)
			.values({
				ownerUserId: flowOwnerId,
				name: 'Import790 Universe',
				slug: unique('import790-universe'),
				kind: 'homebrew'
			})
			.returning({ id: universe.id, slug: universe.slug });
		if (!uni) throw new Error('universe insert did not return a row');
		flowUniverseSlug = uni.slug;

		// packages/import's own kanka fixture (test/fixtures/kanka/campaign-export.zip) -
		// a real export, so this proves the merged action against real archive bytes
		// rather than an empty File the way the viewer-refusal test above uses.
		const fixturePath = fileURLToPath(
			new URL(
				'../../../../../../../packages/import/test/fixtures/kanka/campaign-export.zip',
				import.meta.url
			)
		);
		fixtureBytes = new Uint8Array(await readFile(fixturePath));
	});

	afterAll(async () => {
		await closeDb(flowDb);
	});

	function eventFor(body: FormData) {
		return {
			request: new Request('http://localhost/w/x/import', { method: 'POST', body }),
			params: { universe: flowUniverseSlug },
			locals: { user: { id: flowOwnerId }, locale: 'en' as const }
		};
	}

	it('detects the format and computes a real estimate in the same round trip as the upload, then admits a real job on confirm', async () => {
		const uploadForm = new FormData();
		uploadForm.set(
			'file',
			new File([fixtureBytes], 'campaign-export.zip', { type: 'application/zip' })
		);
		const preview = (await actions.upload(
			eventFor(uploadForm) as Parameters<typeof actions.upload>[0]
		)) as {
			stage: string;
			playbookId: string;
			confident: boolean;
			documentCount: number;
			blocked: string | null;
			tempId: string;
			fileName: string;
			fileBytes: number;
		};
		expect(preview.stage).toBe('preview');
		expect(preview.playbookId).toBe('kanka');
		expect(preview.confident).toBe(true);
		expect(preview.documentCount).toBeGreaterThan(0);
		// DeterministicExtractionDriver runs kanka without a live model
		// (FAKE_DRIVER_SUPPORTED_PLAYBOOKS), so nothing blocks "Start import" here.
		expect(preview.blocked).toBeNull();

		const startForm = new FormData();
		startForm.set('tempId', preview.tempId);
		startForm.set('playbookId', preview.playbookId);
		startForm.set('fileName', preview.fileName);
		startForm.set('fileBytes', String(preview.fileBytes));

		const redirectLocation = await (async () => {
			try {
				await actions.start(eventFor(startForm) as Parameters<typeof actions.start>[0]);
			} catch (err) {
				if (!isRedirect(err)) throw err;
				return err.location;
			}
			throw new Error('expected actions.start to redirect');
		})();
		expect(redirectLocation).toMatch(new RegExp(`^/w/${flowUniverseSlug}/import/.+/review$`));

		const jobId = redirectLocation.split('/').at(-2) ?? '';
		const [row] = await flowDb.select().from(importJob).where(eq(importJob.id, jobId));
		expect(row?.sourceType).toBe('kanka');
		expect(row?.documentCount).toBe(preview.documentCount);
	});

	it('recomputes the preview off the same stored upload when the playbook is overridden', async () => {
		const uploadForm = new FormData();
		uploadForm.set(
			'file',
			new File([fixtureBytes], 'campaign-export.zip', { type: 'application/zip' })
		);
		const uploaded = (await actions.upload(
			eventFor(uploadForm) as Parameters<typeof actions.upload>[0]
		)) as { tempId: string; fileName: string; fileBytes: number };

		const confirmForm = new FormData();
		confirmForm.set('tempId', uploaded.tempId);
		confirmForm.set('playbookId', 'generic');
		confirmForm.set('fileName', uploaded.fileName);
		confirmForm.set('fileBytes', String(uploaded.fileBytes));
		const recomputed = (await actions.confirm(
			eventFor(confirmForm) as Parameters<typeof actions.confirm>[0]
		)) as { stage: string; playbookId: string; documentCount: number };

		expect(recomputed.stage).toBe('preview');
		expect(recomputed.playbookId).toBe('generic');
		// The generic playbook reads every file in the archive as its own document,
		// kanka's JSON export included - a real recomputation, not the kanka detection's
		// own (different) count carried over.
		expect(recomputed.documentCount).toBeGreaterThan(0);
	});

	it('refuses to start a job with no documents this playbook recognises, and reshows the blocked preview', async () => {
		const uploadForm = new FormData();
		uploadForm.set(
			'file',
			new File([fixtureBytes], 'campaign-export.zip', { type: 'application/zip' })
		);
		const uploaded = (await actions.upload(
			eventFor(uploadForm) as Parameters<typeof actions.upload>[0]
		)) as { tempId: string; fileName: string; fileBytes: number };

		// world-anvil expects json/ and html/ top-level folders; kanka's export has
		// neither, so this playbook recognises no documents in it at all.
		const startForm = new FormData();
		startForm.set('tempId', uploaded.tempId);
		startForm.set('playbookId', 'world-anvil');
		startForm.set('fileName', uploaded.fileName);
		startForm.set('fileBytes', String(uploaded.fileBytes));

		const result = (await actions.start(
			eventFor(startForm) as Parameters<typeof actions.start>[0]
		)) as { status: number; data: { stage: string; blocked: string | null; error: string } };
		expect(result.status).toBe(400);
		expect(result.data.stage).toBe('preview');
		expect(result.data.blocked).toBe('no_documents');
		expect(result.data.error).toBeTruthy();
	});
});
