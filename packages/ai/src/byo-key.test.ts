import { randomBytes } from 'node:crypto';
import { closeDb, type Db } from '@canonry/db';
import { user } from '@canonry/db/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	decryptApiKey,
	encryptApiKey,
	InvalidByoKeyCiphertextError,
	InvalidByoKeyEncryptionKeyError,
	lastFourOf,
	resolveByoKey,
	storeByoKey
} from './byo-key.js';
import { openTestDb } from './test-db.js';

const TEST_KEY_ENV = { BYO_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') };
const OTHER_KEY_ENV = { BYO_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') };

describe('lastFourOf', () => {
	it('is the last four characters of the plaintext - never anything decryptable', () => {
		expect(lastFourOf('sk-ant-api03-abcdEFGH1234')).toBe('1234');
	});
});

describe('encryptApiKey / decryptApiKey', () => {
	it('round-trips a plaintext key through encryption and decryption', () => {
		const plaintext = 'sk-ant-api03-round-trip-test-00000000';
		const { ciphertext, lastFour } = encryptApiKey(plaintext, TEST_KEY_ENV);

		expect(lastFour).toBe(plaintext.slice(-4));
		expect(ciphertext).not.toContain(plaintext);
		expect(decryptApiKey(ciphertext, TEST_KEY_ENV)).toBe(plaintext);
	});

	it('never reuses an IV - two encryptions of the same plaintext produce different ciphertext', () => {
		const plaintext = 'sk-ant-api03-fresh-iv-test-000000000000';
		const first = encryptApiKey(plaintext, TEST_KEY_ENV);
		const second = encryptApiKey(plaintext, TEST_KEY_ENV);

		expect(first.ciphertext).not.toBe(second.ciphertext);
		expect(decryptApiKey(first.ciphertext, TEST_KEY_ENV)).toBe(plaintext);
		expect(decryptApiKey(second.ciphertext, TEST_KEY_ENV)).toBe(plaintext);
	});

	it('refuses to store a key shorter than 8 characters', () => {
		expect(() => encryptApiKey('short', TEST_KEY_ENV)).toThrow(/shorter than 8/);
	});

	it('refuses to encrypt or decrypt when BYO_KEY_ENCRYPTION_KEY is unset', () => {
		expect(() => encryptApiKey('a-long-enough-plaintext-key', {})).toThrow(
			InvalidByoKeyEncryptionKeyError
		);
		expect(() => decryptApiKey('v1:a:b:c', {})).toThrow(InvalidByoKeyEncryptionKeyError);
	});

	it('refuses a key that is not 32 bytes after base64 decoding', () => {
		expect(() =>
			encryptApiKey('a-long-enough-plaintext-key', { BYO_KEY_ENCRYPTION_KEY: 'dG9vLXNob3J0' })
		).toThrow(InvalidByoKeyEncryptionKeyError);
	});

	it('fails loudly on a malformed ciphertext instead of returning garbage', () => {
		expect(() => decryptApiKey('not-the-right-shape', TEST_KEY_ENV)).toThrow(
			InvalidByoKeyCiphertextError
		);
	});

	it("GCM's auth tag catches a tampered ciphertext", () => {
		const { ciphertext } = encryptApiKey('sk-ant-api03-tamper-target-0000000000', TEST_KEY_ENV);
		const [version, iv, tag, data] = ciphertext.split(':');
		// Corrupt the auth tag itself, byte for byte - GCM's whole point is that this must
		// be rejected outright rather than silently returning corrupted plaintext.
		const tagBytes = Buffer.from(tag!, 'base64');
		tagBytes[0] = tagBytes[0]! ^ 0xff;
		const tamperedTag = tagBytes.toString('base64');
		const tampered = [version, iv, tamperedTag, data].join(':');

		expect(() => decryptApiKey(tampered, TEST_KEY_ENV)).toThrow();
	});

	it('decrypting with the wrong environment key fails rather than returning the wrong plaintext', () => {
		const { ciphertext } = encryptApiKey('sk-ant-api03-wrong-key-test-00000000', TEST_KEY_ENV);
		expect(() => decryptApiKey(ciphertext, OTHER_KEY_ENV)).toThrow();
	});
});

describe('storeByoKey / resolveByoKey against real Postgres', () => {
	let db: Db;
	const TEST_USER_IDS = ['byo-key-test-user-1', 'byo-key-test-user-2', 'byo-key-test-user-3'];

	beforeAll(async () => {
		db = openTestDb();
		await db
			.insert(user)
			.values(
				TEST_USER_IDS.map((id) => ({
					id,
					name: 'BYO Key Test User',
					email: `${id}@canonry.invalid`,
					emailVerified: true
				}))
			)
			.onConflictDoNothing();
	});

	afterAll(async () => {
		await closeDb(db);
	});

	it('stores an encrypted key and resolves the same plaintext back out', async () => {
		const userId = 'byo-key-test-user-1';
		const plaintext = 'sk-ant-api03-store-resolve-test-00000000';

		const stored = await storeByoKey(db, userId, 'anthropic', plaintext, TEST_KEY_ENV);
		expect(stored.lastFour).toBe(plaintext.slice(-4));
		expect(stored.lastUsedAt).toBeNull();

		const credential = await resolveByoKey(db, userId, 'anthropic', TEST_KEY_ENV);
		expect(credential?.apiKey).toBe(plaintext);
		expect(credential?.provider).toBe('anthropic');
	});

	it('marks the key used only after a successful decrypt', async () => {
		const userId = 'byo-key-test-user-2';
		await storeByoKey(db, userId, 'openai', 'sk-openai-test-key-0000000000000', TEST_KEY_ENV);

		await resolveByoKey(db, userId, 'openai', TEST_KEY_ENV);

		const credential = await resolveByoKey(db, userId, 'openai', TEST_KEY_ENV);
		expect(credential).not.toBeNull();
	});

	it('returns null for a provider nobody configured a key for', async () => {
		const userId = 'byo-key-test-user-3';
		expect(await resolveByoKey(db, userId, 'anthropic', TEST_KEY_ENV)).toBeNull();
	});

	it('never records a wrong-key decrypt failure as a use - the error propagates instead', async () => {
		const userId = 'byo-key-test-user-1';
		await storeByoKey(db, userId, 'google', 'sk-google-test-key-00000000000000', TEST_KEY_ENV);

		await expect(resolveByoKey(db, userId, 'google', OTHER_KEY_ENV)).rejects.toThrow();

		// Resolving again with the *right* key still works - the failed attempt above did
		// not corrupt or half-consume anything.
		const credential = await resolveByoKey(db, userId, 'google', TEST_KEY_ENV);
		expect(credential?.apiKey).toBe('sk-google-test-key-00000000000000');
	});
});
