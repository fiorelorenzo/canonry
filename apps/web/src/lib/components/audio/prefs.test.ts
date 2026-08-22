import { describe, expect, it } from 'vitest';
import {
	audioPrefsStorageKey,
	DEFAULT_MASTER_VOLUME,
	layerPrefsOrDefault,
	loadAudioPrefs,
	saveAudioPrefs,
	type AudioPrefs
} from './prefs';

/** A minimal in-memory `Storage` double - real `localStorage` does not exist under
 * vitest's `node` test environment, and this file's own contract (`Pick<Storage, ...>`)
 * exists specifically so a fake this small is enough. */
class FakeStorage {
	private data = new Map<string, string>();
	getItem(key: string): string | null {
		return this.data.get(key) ?? null;
	}
	setItem(key: string, value: string): void {
		this.data.set(key, value);
	}
}

describe('audioPrefsStorageKey', () => {
	it('namespaces by user id so two accounts on one device never collide', () => {
		expect(audioPrefsStorageKey('user-a')).not.toBe(audioPrefsStorageKey('user-b'));
		expect(audioPrefsStorageKey('user-a')).toContain('user-a');
	});
});

describe('loadAudioPrefs / saveAudioPrefs', () => {
	it('round-trips a saved value', () => {
		const storage = new FakeStorage();
		const prefs: AudioPrefs = {
			masterVolume: 0.55,
			layers: { 'layer-1': { muted: true, volume: 0.3 } }
		};
		saveAudioPrefs(storage, 'user-a', prefs);
		expect(loadAudioPrefs(storage, 'user-a')).toEqual(prefs);
	});

	it('returns defaults when nothing was ever saved', () => {
		const storage = new FakeStorage();
		expect(loadAudioPrefs(storage, 'user-a')).toEqual({
			masterVolume: DEFAULT_MASTER_VOLUME,
			layers: {}
		});
	});

	it('returns defaults rather than throwing on corrupted JSON', () => {
		const storage = new FakeStorage();
		storage.setItem(audioPrefsStorageKey('user-a'), '{not json');
		expect(loadAudioPrefs(storage, 'user-a')).toEqual({
			masterVolume: DEFAULT_MASTER_VOLUME,
			layers: {}
		});
	});

	it('returns defaults rather than trusting a value shaped some other way', () => {
		const storage = new FakeStorage();
		storage.setItem(audioPrefsStorageKey('user-a'), JSON.stringify({ unrelated: true }));
		expect(loadAudioPrefs(storage, 'user-a')).toEqual({
			masterVolume: DEFAULT_MASTER_VOLUME,
			layers: {}
		});
	});

	it('never reads user B prefs for user A', () => {
		const storage = new FakeStorage();
		saveAudioPrefs(storage, 'user-b', { masterVolume: 0.1, layers: {} });
		expect(loadAudioPrefs(storage, 'user-a')).toEqual({
			masterVolume: DEFAULT_MASTER_VOLUME,
			layers: {}
		});
	});
});

describe('layerPrefsOrDefault', () => {
	it('falls back to the server-suggested volume, unmuted, for an unseen layer', () => {
		const prefs: AudioPrefs = { masterVolume: 0.8, layers: {} };
		expect(layerPrefsOrDefault(prefs, 'layer-1', 0.6)).toEqual({ muted: false, volume: 0.6 });
	});

	it('returns the stored override once one exists', () => {
		const prefs: AudioPrefs = {
			masterVolume: 0.8,
			layers: { 'layer-1': { muted: true, volume: 0.2 } }
		};
		expect(layerPrefsOrDefault(prefs, 'layer-1', 0.6)).toEqual({ muted: true, volume: 0.2 });
	});
});
