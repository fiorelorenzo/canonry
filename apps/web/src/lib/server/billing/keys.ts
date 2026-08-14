/**
 * Server-side glue for /settings/keys (#90): wires @canonry/ai's byo-key.ts (encryption,
 * decryption, the resolveByoKey seam a real model call will use once one exists) to this
 * app's own env access and db() singleton, so the route file stays a thin SvelteKit
 * load/actions shape - the same role $lib/server/media.ts plays for image generation.
 */
import { env } from '$env/dynamic/private';
import { storeByoKey, KNOWN_PROVIDERS } from '@canonry/ai';
import { deleteByoKey, listByoKeys, setByoKeyActive, type ByoKeyRow } from '@canonry/db';
import { db } from '../db.js';

export type { ByoKeyRow };

/** Every provider composition.ts can actually route a call through - offering a provider
 * outside this set would be a control with no effect, since createLanguageModel would
 * throw UnknownProviderError the moment it tried to use the key. */
export const BYO_KEY_PROVIDERS: readonly string[] = KNOWN_PROVIDERS;

export function isByoKeyProvider(value: string): boolean {
	return BYO_KEY_PROVIDERS.includes(value);
}

export async function listKeysForUser(userId: string): Promise<ByoKeyRow[]> {
	return listByoKeys(db(), userId);
}

/** Encrypts and stores `plaintext`, replacing and reactivating any existing key for the
 * same provider. The caller (the form action) is responsible for never doing anything
 * else with `plaintext` after this call returns. */
export async function addOrReplaceKey(
	userId: string,
	provider: string,
	plaintext: string
): Promise<ByoKeyRow> {
	return storeByoKey(db(), userId, provider, plaintext, env);
}

export async function setKeyActive(
	userId: string,
	provider: string,
	active: boolean
): Promise<void> {
	await setByoKeyActive(db(), userId, provider, active);
}

export async function removeKey(userId: string, provider: string): Promise<void> {
	await deleteByoKey(db(), userId, provider);
}
