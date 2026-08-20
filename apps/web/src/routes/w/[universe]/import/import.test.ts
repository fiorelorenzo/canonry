/**
 * Issue R11, round thirteen: `/w/[universe]/import`, the door for a world that already
 * exists. Proof that the index reads this universe's real `import_job` rows (not only
 * that the page renders), that a viewer sees the same list read-only, and that a
 * non-member gets the same 404 as every other `/w/` route - the check nobody ran, per
 * the issue's own "How to verify". Same real-Postgres, real-handler convention as
 * `players/players.test.ts` next door and `admin/models/aspect-ratio-guard.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, type Db } from '@canonry/db';
import { importJob, universe, universeMember, user } from '@canonry/db/schema';
import { isHttpError } from '@sveltejs/kit';
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
