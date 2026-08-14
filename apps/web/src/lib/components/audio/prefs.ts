/**
 * Per-device audio preferences for issue #69: "Per-layer mute and volume, plus a master
 * volume, persisted per user in localStorage (not the database: this is a device
 * preference, and SPEC section 8 does not ask for it to follow the account)". Keyed by
 * user id so a shared machine with more than one Canonry account never mixes their
 * volume choices, without needing a server round trip or a new table.
 *
 * Takes a `Pick<Storage, ...>` rather than the real `localStorage` global so this stays
 * testable under plain Node (no jsdom) with a small in-memory fake.
 */

export interface LayerPrefs {
	muted: boolean;
	/** Absolute 0-1 volume, not a multiplier - defaults to the layer's server-suggested
	 * volume until the GM overrides it, then stays exactly what they set. */
	volume: number;
}

export interface AudioPrefs {
	masterVolume: number;
	layers: Record<string, LayerPrefs>;
}

export const DEFAULT_MASTER_VOLUME = 0.8;

export function audioPrefsStorageKey(userId: string): string {
	return `canonry:audio-prefs:v1:${userId}`;
}

function emptyPrefs(): AudioPrefs {
	return { masterVolume: DEFAULT_MASTER_VOLUME, layers: {} };
}

function isLayerPrefs(value: unknown): value is LayerPrefs {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as LayerPrefs).muted === 'boolean' &&
		typeof (value as LayerPrefs).volume === 'number'
	);
}

/** Real runtime check, not an inline cast (matches `_context.ts`'s `'text' in payload`
 * convention) - a value written by a future or older shape of this file, or corrupted by
 * hand, is treated as absent rather than trusted. */
function isAudioPrefs(value: unknown): value is AudioPrefs {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as AudioPrefs;
	if (typeof candidate.masterVolume !== 'number') return false;
	if (typeof candidate.layers !== 'object' || candidate.layers === null) return false;
	return Object.values(candidate.layers).every(isLayerPrefs);
}

export function loadAudioPrefs(storage: Pick<Storage, 'getItem'>, userId: string): AudioPrefs {
	try {
		const raw = storage.getItem(audioPrefsStorageKey(userId));
		if (!raw) return emptyPrefs();
		const parsed: unknown = JSON.parse(raw);
		return isAudioPrefs(parsed) ? parsed : emptyPrefs();
	} catch {
		return emptyPrefs();
	}
}

export function saveAudioPrefs(
	storage: Pick<Storage, 'setItem'>,
	userId: string,
	prefs: AudioPrefs
): void {
	storage.setItem(audioPrefsStorageKey(userId), JSON.stringify(prefs));
}

/** The prefs for one layer, falling back to the layer's own server-suggested volume
 * (never muted) the first time it is ever seen. */
export function layerPrefsOrDefault(
	prefs: AudioPrefs,
	layerId: string,
	defaultVolume: number
): LayerPrefs {
	return prefs.layers[layerId] ?? { muted: false, volume: defaultVolume };
}
