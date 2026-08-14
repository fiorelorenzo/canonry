/**
 * SPEC.md §15, issue #90: byo_key's query layer. Never asserts on `ciphertext` here -
 * that column is deliberately unreachable from listByoKeys, and activeByoKeySecret is
 * covered by @canonry/ai's byo-key.test.ts, which is where the actual encryption lives.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	activeByoKeySecret,
	closeDb,
	deleteByoKey,
	listByoKeys,
	setByoKeyActive,
	touchByoKeyUsage,
	upsertByoKey,
	type Db
} from '../src/index.js';
import { byoKey } from '../src/schema/billing.js';
import { insertUser, testDb } from './helpers.js';

describe('byo_key queries', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('stores only ciphertext and last four - listByoKeys never carries the secret', async () => {
		const owner = await insertUser(db);

		await upsertByoKey(db, {
			userId: owner.id,
			provider: 'anthropic',
			ciphertext: 'v1:fake-iv:fake-tag:fake-data',
			lastFour: 'wxyz'
		});

		const rows = await listByoKeys(db, owner.id);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ provider: 'anthropic', lastFour: 'wxyz', active: true });
		expect(rows[0]).not.toHaveProperty('ciphertext');

		// The raw row really does hold the ciphertext this test wrote - proving
		// listByoKeys' omission is a deliberate projection, not an accidental miss.
		const [raw] = await db.select().from(byoKey).where(eq(byoKey.userId, owner.id));
		expect(raw?.ciphertext).toBe('v1:fake-iv:fake-tag:fake-data');
	});

	it('replaces the existing row for the same user+provider and reactivates it', async () => {
		const owner = await insertUser(db);

		const first = await upsertByoKey(db, {
			userId: owner.id,
			provider: 'openai',
			ciphertext: 'v1:iv1:tag1:data1',
			lastFour: '1111'
		});
		await setByoKeyActive(db, owner.id, 'openai', false);

		const second = await upsertByoKey(db, {
			userId: owner.id,
			provider: 'openai',
			ciphertext: 'v1:iv2:tag2:data2',
			lastFour: '2222'
		});

		expect(second.id).toBe(first.id);
		expect(second.active).toBe(true);

		const rows = await listByoKeys(db, owner.id);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.lastFour).toBe('2222');
	});

	it('activeByoKeySecret returns null once a key is switched off, and the row again once switched back on', async () => {
		const owner = await insertUser(db);
		await upsertByoKey(db, {
			userId: owner.id,
			provider: 'anthropic',
			ciphertext: 'v1:iv:tag:data',
			lastFour: '9999'
		});

		expect(await activeByoKeySecret(db, owner.id, 'anthropic')).not.toBeNull();

		await setByoKeyActive(db, owner.id, 'anthropic', false);
		expect(await activeByoKeySecret(db, owner.id, 'anthropic')).toBeNull();

		await setByoKeyActive(db, owner.id, 'anthropic', true);
		const active = await activeByoKeySecret(db, owner.id, 'anthropic');
		expect(active?.ciphertext).toBe('v1:iv:tag:data');
	});

	it('activeByoKeySecret is null for a provider that was never configured', async () => {
		const owner = await insertUser(db);
		expect(await activeByoKeySecret(db, owner.id, 'anthropic')).toBeNull();
	});

	it('touchByoKeyUsage records when a key was last used', async () => {
		const owner = await insertUser(db);
		const row = await upsertByoKey(db, {
			userId: owner.id,
			provider: 'anthropic',
			ciphertext: 'v1:iv:tag:data',
			lastFour: '4444'
		});
		expect(row.lastUsedAt).toBeNull();

		await touchByoKeyUsage(db, row.id);

		const [rows] = [await listByoKeys(db, owner.id)];
		expect(rows[0]?.lastUsedAt).not.toBeNull();
	});

	it('deleteByoKey removes the row entirely, unlike switching it off', async () => {
		const owner = await insertUser(db);
		await upsertByoKey(db, {
			userId: owner.id,
			provider: 'anthropic',
			ciphertext: 'v1:iv:tag:data',
			lastFour: '5555'
		});

		await deleteByoKey(db, owner.id, 'anthropic');

		expect(await listByoKeys(db, owner.id)).toHaveLength(0);
		expect(await activeByoKeySecret(db, owner.id, 'anthropic')).toBeNull();
	});
});
