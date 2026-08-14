/**
 * Bring your own key (SPEC.md §15, decision F3 = C, issue #90): stays available, never
 * the default. Encrypted at rest with a key from the environment - only the ciphertext
 * and the last four characters ever leave `@canonry/db`'s byo_key table, so a settings
 * page can say which key is configured without decrypting anything to display it.
 *
 * AES-256-GCM, a fresh random 12-byte IV per encryption (GCM's own requirement - reusing
 * an IV under the same key breaks its authentication guarantee, so nothing here derives
 * one from anything predictable). The stored ciphertext is
 * `v1:<iv-b64>:<authTag-b64>:<encrypted-b64>` - versioned so a future algorithm change has
 * somewhere to branch without guessing at what an old row's ciphertext means.
 *
 * The plaintext key touches exactly two places outside this module: the settings-page
 * form action that calls `storeByoKey` (discarded the moment the response is sent) and
 * `createLanguageModel`'s `providerApiKey` parameter (composition.ts) that
 * `resolveByoKey`'s caller passes it to. It is never a field `packages/ai`'s logger
 * (logger.ts) accepts - see logger.test.ts's issue #90 case - and this module never logs
 * it either.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Db } from '@canonry/db';
import { activeByoKeySecret, touchByoKeyUsage, upsertByoKey, type ByoKeyRow } from '@canonry/db';

export type { ByoKeyRow };

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const CIPHERTEXT_VERSION = 'v1';
const MIN_PLAINTEXT_LENGTH = 8;

export class InvalidByoKeyEncryptionKeyError extends Error {
	constructor(reason: string) {
		super(
			`BYO_KEY_ENCRYPTION_KEY is ${reason}: bring-your-own-key storage cannot encrypt or ` +
				'decrypt without a real 32-byte key. Generate one with `openssl rand -base64 32`.'
		);
		this.name = 'InvalidByoKeyEncryptionKeyError';
	}
}

export class InvalidByoKeyCiphertextError extends Error {
	constructor(reason: string) {
		super(`stored byo_key ciphertext is not well-formed: ${reason}`);
		this.name = 'InvalidByoKeyCiphertextError';
	}
}

function readEncryptionKey(env: NodeJS.ProcessEnv): Buffer {
	const raw = env.BYO_KEY_ENCRYPTION_KEY;
	if (!raw) throw new InvalidByoKeyEncryptionKeyError('not set');
	const key = Buffer.from(raw, 'base64');
	if (key.length !== 32) {
		throw new InvalidByoKeyEncryptionKeyError(`${key.length} bytes after base64 decoding, not 32`);
	}
	return key;
}

/** The settings page's own "which key is this" hint (#90) - the only fragment of a
 * plaintext key this package ever persists or displays. */
export function lastFourOf(plaintext: string): string {
	return plaintext.slice(-4);
}

export interface EncryptedApiKey {
	ciphertext: string;
	lastFour: string;
}

/** Encrypts a plaintext provider key for storage. The caller is responsible for
 * discarding its own copy of `plaintext` once this returns - nothing here retains it. */
export function encryptApiKey(
	plaintext: string,
	env: NodeJS.ProcessEnv = process.env
): EncryptedApiKey {
	if (plaintext.length < MIN_PLAINTEXT_LENGTH) {
		throw new Error(
			`encryptApiKey: refusing to store a key shorter than ${MIN_PLAINTEXT_LENGTH} characters`
		);
	}
	const key = readEncryptionKey(env);
	const iv = randomBytes(IV_LENGTH_BYTES);
	const cipher = createCipheriv(ALGORITHM, key, iv);
	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const authTag = cipher.getAuthTag();
	const ciphertext = [
		CIPHERTEXT_VERSION,
		iv.toString('base64'),
		authTag.toString('base64'),
		encrypted.toString('base64')
	].join(':');
	return { ciphertext, lastFour: lastFourOf(plaintext) };
}

/** The inverse of encryptApiKey. GCM's own auth tag check (inside `decipher.final()`)
 * is what actually proves the ciphertext was not tampered with - there is no separate
 * integrity check to get wrong here. */
export function decryptApiKey(ciphertext: string, env: NodeJS.ProcessEnv = process.env): string {
	const parts = ciphertext.split(':');
	if (parts.length !== 4 || parts[0] !== CIPHERTEXT_VERSION) {
		throw new InvalidByoKeyCiphertextError(
			`expected "${CIPHERTEXT_VERSION}:<iv>:<tag>:<data>", got ${parts.length} segment(s)`
		);
	}
	const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
	const key = readEncryptionKey(env);
	const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
	decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
	const decrypted = Buffer.concat([
		decipher.update(Buffer.from(dataB64, 'base64')),
		decipher.final()
	]);
	return decrypted.toString('utf8');
}

/** The settings-page write path (#90): encrypts the plaintext and stores it, replacing
 * (and reactivating) any existing key for the same user+provider. */
export async function storeByoKey(
	db: Db,
	userId: string,
	provider: string,
	plaintext: string,
	env: NodeJS.ProcessEnv = process.env
): Promise<ByoKeyRow> {
	const { ciphertext, lastFour } = encryptApiKey(plaintext, env);
	return upsertByoKey(db, { userId, provider, ciphertext, lastFour });
}

export interface ByoKeyCredential {
	id: string;
	provider: string;
	/** Decrypted. Hand this straight to `createLanguageModel`'s `providerApiKey`
	 * parameter (composition.ts) - never to a log line, an error message, or anywhere
	 * else outside that one call. */
	apiKey: string;
}

/**
 * Resolves whether a call for `provider` should route through this user's own key
 * instead of the platform's. Returns null when none is configured or the configured one
 * is switched off - a caller treats both identically: fall back to platform routing
 * through Unified Billing, and full pricing through `withQuota`.
 *
 * Marks the key used on every successful resolution (`touchByoKeyUsage` - the settings
 * page's "last used" column) - deliberately after the decrypt, not before, so a
 * ciphertext that fails to decrypt (a wrong BYO_KEY_ENCRYPTION_KEY after a botched
 * rotation, say) is never recorded as having been used.
 */
export async function resolveByoKey(
	db: Db,
	userId: string,
	provider: string,
	env: NodeJS.ProcessEnv = process.env
): Promise<ByoKeyCredential | null> {
	const row = await activeByoKeySecret(db, userId, provider);
	if (!row) return null;
	const apiKey = decryptApiKey(row.ciphertext, env);
	await touchByoKeyUsage(db, row.id);
	return { id: row.id, provider, apiKey };
}
