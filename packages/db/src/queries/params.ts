/**
 * Generic merge for the jsonb `params` column `image_model_config` and `model_config`
 * both carry (issue #235). A save through /admin/models must replace only the keys the
 * form itself renders and leave every other key of the stored object exactly as it was
 * - not "shallow spread whatever the request happened to carry", which is how
 * `imagesPerRequest` (migration 0011, read by nothing in `packages/media`) went from
 * every previous save's survivor to one image-price edit away from disappearing.
 *
 * `ownedKeys` is the caller's explicit allowlist, never inferred from `updates`' own
 * keys: a caller that genuinely owns a key still has to be able to remove it, so
 * leaving that key out of `updates` deletes it from the merged result rather than
 * falling back to whatever `existing` held. Every key of `existing` outside
 * `ownedKeys` passes through untouched, whatever it is - this module never inspects or
 * validates it.
 */
export function mergeOwnedParams(
	existing: unknown,
	ownedKeys: readonly string[],
	updates: Record<string, unknown>
): Record<string, unknown> {
	const base =
		typeof existing === 'object' && existing !== null ? (existing as Record<string, unknown>) : {};

	const merged: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(base)) {
		if (!ownedKeys.includes(key)) merged[key] = value;
	}
	for (const key of ownedKeys) {
		if (key in updates && updates[key] !== undefined) merged[key] = updates[key];
	}
	return merged;
}
