/**
 * The Web Audio engine behind issue #69: continuous layers loop natively (never
 * restarted on `ended`), packs crossfade on the audio clock via
 * `GainNode.gain.linearRampToValueAtTime`, and oneshot/interval layers fire on top.
 * Framework-free by design - `AmbientPlayer.svelte` owns the UI and localStorage
 * preferences, this file only knows about `AudioContext` and the layer shapes
 * `packages/media/src/audio/generate.ts`'s `AmbientLayerResult` already defines.
 *
 * Verified two ways, deliberately: `ambient-player.test.ts` drives this class against a
 * hand-written fake `AudioContext` for deterministic, jsdom-free coverage of the
 * scheduling and gain-automation *decisions* this file makes; the real Web Audio graph
 * (real `AudioContext`, real decoded WAV bytes) is verified live in a browser via
 * `tab.evaluate` reading `snapshot()` and the node properties directly, which is the
 * only way to prove real audio-clock behaviour on a box with no audio output device.
 */
import { clampUnit, findLoopBoundaries, randomIntervalDelaySeconds } from './loop-boundaries.js';

export type LoopType = 'continuous' | 'oneshot' | 'interval';

export interface LayerSpec {
	/** The layer's `media_asset.id` - stable across reloads, used as the localStorage
	 * preference key and the snapshot/debug id. */
	id: string;
	/** Byte-serving URL - built server-side from the existing
	 * `u/[universe]/e/[slug]/media/[id]` route, never a second media route. */
	url: string;
	loopType: LoopType;
	intervalMinSeconds?: number;
	intervalMaxSeconds?: number;
	/** Server-suggested baseline volume (0-1), used until a device preference overrides
	 * it. */
	volume: number;
	prompt: string;
}

export interface PackSpec {
	id: string;
	description: string;
	layers: LayerSpec[];
}

interface LayerVoice {
	spec: LayerSpec;
	buffer: AudioBuffer;
	gain: GainNode;
	muted: boolean;
	volume: number;
	/** The one long-lived source for a continuous layer, or the most recently started
	 * source for a oneshot layer - kept only so `snapshot()` can report `loop`/
	 * `loopStart`/`loopEnd` back for verification. Interval layers create a fresh source
	 * per firing and do not keep one here. */
	source: AudioBufferSourceNode | null;
	intervalTimer: TimerHandle | null;
}

/** A browser timer handle. Deliberately not `ReturnType<typeof setTimeout>`: that
 * resolves to `NodeJS.Timeout` or `number` depending on which ambient lib
 * (`@types/node` vs DOM) TypeScript picks up in a given file, and this engine only ever
 * runs in a browser, where a real `setTimeout` call always returns a `number`. */
export type TimerHandle = number;
export type SetTimeoutFn = (callback: () => void, delayMs: number) => TimerHandle;
export type ClearTimeoutFn = (handle: TimerHandle) => void;

export interface PackVoice {
	spec: PackSpec;
	packGain: GainNode;
	layers: LayerVoice[];
	/** Any layer that failed to fetch or decode - the pack still plays with the rest,
	 * this is surfaced to the UI rather than silently dropped. */
	loadErrors: Array<{ layerId: string; message: string }>;
}

export interface EngineSnapshot {
	contextState: AudioContextState | 'unstarted';
	currentTime: number;
	sampleRate: number | null;
	masterVolume: number;
	activePack: {
		id: string;
		packGain: number;
		layers: Array<{
			id: string;
			loopType: LoopType;
			muted: boolean;
			volume: number;
			gain: number;
			loop: boolean;
			loopStart: number;
			loopEnd: number;
			bufferDurationSeconds: number;
		}>;
	} | null;
	fadingOutPackCount: number;
}

const DEFAULT_CROSSFADE_SECONDS = 4;
/** Short ramp for a mute/volume change mid-playback, so turning a layer off is a fade
 * rather than a click - the same reasoning `findLoopBoundaries` applies to the loop
 * seam, applied to a user action instead of a buffer edge. */
const PARAM_RAMP_SECONDS = 0.05;

export interface AmbientEngineOptions {
	/** Builds the real `AudioContext` lazily, only on the first `ensureContext()` call
	 * (never at construction) - `AudioPlayer.svelte` never runs this before a user
	 * gesture, which is what keeps autoplay policies from ever seeing an unexpected
	 * `resume()` call. Overridable so `ambient-player.test.ts` can inject a fake. */
	createContext?: () => AudioContext;
	setTimeoutFn?: SetTimeoutFn;
	clearTimeoutFn?: ClearTimeoutFn;
	fetchFn?: typeof fetch;
	rng?: () => number;
}

export class AmbientEngine {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private active: PackVoice | null = null;
	private fadingOut = new Set<PackVoice>();
	private readonly createContext: () => AudioContext;
	private readonly setTimeoutFn: SetTimeoutFn;
	private readonly clearTimeoutFn: ClearTimeoutFn;
	private readonly fetchFn: typeof fetch;
	private readonly rng: () => number;
	private masterVolumeValue = 1;

	constructor(options: AmbientEngineOptions = {}) {
		this.createContext = options.createContext ?? (() => new AudioContext());
		this.setTimeoutFn =
			options.setTimeoutFn ??
			((callback, delayMs) => setTimeout(callback, delayMs) as unknown as TimerHandle);
		this.clearTimeoutFn = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle));
		this.fetchFn = options.fetchFn ?? fetch;
		this.rng = options.rng ?? Math.random;
	}

	get contextState(): AudioContextState | 'unstarted' {
		return this.ctx?.state ?? 'unstarted';
	}

	/** Creates the `AudioContext` if it does not exist yet (still `suspended` in every
	 * modern browser until a user gesture resumes it - this method never resumes it
	 * itself). Safe to call more than once. */
	ensureContext(): AudioContext {
		if (!this.ctx) {
			const ctx = this.createContext();
			this.master = ctx.createGain();
			this.master.gain.value = this.masterVolumeValue;
			this.master.connect(ctx.destination);
			this.ctx = ctx;
		}
		return this.ctx;
	}

	/** Must be called from inside a user gesture handler. Never throws and never leaves
	 * an unhandled rejection - issue #69's "must not log an unhandled rejection when the
	 * audio context is suspended" - a browser that refuses `resume()` (no gesture, or
	 * the tab was never focused) leaves the context `suspended` and the caller reads
	 * that back from `contextState` to show it visibly instead. */
	async resume(): Promise<void> {
		const ctx = this.ensureContext();
		try {
			await ctx.resume();
		} catch {
			// contextState still reflects reality; nothing else to do here.
		}
	}

	async suspend(): Promise<void> {
		if (!this.ctx) return;
		try {
			await this.ctx.suspend();
		} catch {
			// Same reasoning as resume(): the caller reads contextState, not this result.
		}
	}

	setMasterVolume(volume: number): void {
		this.masterVolumeValue = clampUnit(volume);
		if (!this.ctx || !this.master) return;
		const now = this.ctx.currentTime;
		this.master.gain.cancelScheduledValues(now);
		this.master.gain.setValueAtTime(this.master.gain.value, now);
		this.master.gain.linearRampToValueAtTime(this.masterVolumeValue, now + PARAM_RAMP_SECONDS);
	}

	/** Fetches and decodes every layer's bytes and builds its nodes, but starts nothing -
	 * `playPack` (or `crossfadeTo`, which calls it internally) is the only place a source
	 * is ever started, so "loaded" and "audible" stay two separate, ordered steps. */
	async loadPack(spec: PackSpec): Promise<PackVoice> {
		const ctx = this.ensureContext();
		const packGain = ctx.createGain();
		packGain.gain.value = 0;
		packGain.connect(this.master ?? ctx.destination);

		const layers: LayerVoice[] = [];
		const loadErrors: Array<{ layerId: string; message: string }> = [];

		for (const layerSpec of spec.layers) {
			try {
				const response = await this.fetchFn(layerSpec.url);
				if (!response.ok) throw new Error(`fetch failed (${response.status})`);
				const bytes = await response.arrayBuffer();
				const buffer = await ctx.decodeAudioData(bytes);

				const gain = ctx.createGain();
				gain.gain.value = clampUnit(layerSpec.volume);
				gain.connect(packGain);

				layers.push({
					spec: layerSpec,
					buffer,
					gain,
					muted: false,
					volume: clampUnit(layerSpec.volume),
					source: null,
					intervalTimer: null
				});
			} catch (error) {
				loadErrors.push({
					layerId: layerSpec.id,
					message: error instanceof Error ? error.message : String(error)
				});
			}
		}

		return { spec, packGain, layers, loadErrors };
	}

	/** Starts every layer of an already-loaded pack: continuous layers loop natively via
	 * `AudioBufferSourceNode.loop`/`loopStart`/`loopEnd` and are started exactly once;
	 * oneshot layers start once and never repeat; interval layers schedule their first
	 * firing. Nothing here restarts a source on its `ended` event - that is the
	 * loop-gap defect this issue exists to avoid. */
	playPack(voice: PackVoice): void {
		const ctx = this.ensureContext();
		for (const layer of voice.layers) {
			if (layer.spec.loopType === 'continuous') {
				const source = this.startBufferSource(ctx, layer, true);
				layer.source = source;
			} else if (layer.spec.loopType === 'oneshot') {
				layer.source = this.startBufferSource(ctx, layer, false);
			} else {
				this.scheduleIntervalLayer(layer);
			}
		}
	}

	private startBufferSource(
		ctx: AudioContext,
		layer: LayerVoice,
		loop: boolean
	): AudioBufferSourceNode {
		const source = ctx.createBufferSource();
		source.buffer = layer.buffer;
		if (loop) {
			const bounds = findLoopBoundaries(
				layer.buffer.getChannelData(0),
				layer.buffer.sampleRate,
				layer.buffer.duration
			);
			source.loop = true;
			source.loopStart = bounds.loopStart;
			source.loopEnd = bounds.loopEnd;
		}
		source.connect(layer.gain);
		source.start(ctx.currentTime);
		return source;
	}

	/** The one place this engine uses a plain timer rather than the audio clock, and
	 * deliberately so: Web Audio has no primitive for "repeat at a random interval",
	 * only for "start at an exact time". The timer only ever decides *when* to enqueue
	 * the next firing; the firing itself is `source.start(ctx.currentTime)`, which is
	 * audio-clock-precise at the moment it runs. This is not the crossfade gain ramp
	 * issue #69 requires the audio clock for - that is `crossfadeTo`, below. */
	private scheduleIntervalLayer(layer: LayerVoice): void {
		const delaySeconds = randomIntervalDelaySeconds(
			layer.spec.intervalMinSeconds,
			layer.spec.intervalMaxSeconds,
			this.rng
		);
		layer.intervalTimer = this.setTimeoutFn(() => {
			if (!this.ctx) return;
			const source = this.ctx.createBufferSource();
			source.buffer = layer.buffer;
			source.connect(layer.gain);
			source.start(this.ctx.currentTime);
			this.scheduleIntervalLayer(layer);
		}, delaySeconds * 1000);
	}

	/**
	 * Crossfades from whatever is currently active to `spec` over `durationSeconds`
	 * (default a few seconds, per issue #69). Both ramps are scheduled with
	 * `GainNode.gain.linearRampToValueAtTime` against `ctx.currentTime` - the only
	 * `setTimeout` involved is a cleanup timer that stops and disconnects the outgoing
	 * pack's nodes once its ramp has actually finished, which is a resource-cleanup
	 * concern, never the audio timing itself.
	 */
	async crossfadeTo(
		spec: PackSpec,
		durationSeconds = DEFAULT_CROSSFADE_SECONDS
	): Promise<PackVoice> {
		const ctx = this.ensureContext();
		const incoming = await this.loadPack(spec);
		this.playPack(incoming);

		const now = ctx.currentTime;
		const outgoing = this.active;

		if (outgoing) {
			this.fadingOut.add(outgoing);
			outgoing.packGain.gain.cancelScheduledValues(now);
			outgoing.packGain.gain.setValueAtTime(outgoing.packGain.gain.value, now);
			outgoing.packGain.gain.linearRampToValueAtTime(0, now + durationSeconds);
		}

		incoming.packGain.gain.cancelScheduledValues(now);
		incoming.packGain.gain.setValueAtTime(0, now);
		incoming.packGain.gain.linearRampToValueAtTime(1, now + durationSeconds);

		this.active = incoming;

		if (outgoing) {
			this.setTimeoutFn(
				() => {
					this.disposeVoice(outgoing);
					this.fadingOut.delete(outgoing);
				},
				durationSeconds * 1000 + 100
			);
		}

		return incoming;
	}

	/** Immediate start with no fade - the first pack of a session has nothing to fade
	 * from. */
	async playNewPack(spec: PackSpec): Promise<PackVoice> {
		const ctx = this.ensureContext();
		const voice = await this.loadPack(spec);
		const now = ctx.currentTime;
		voice.packGain.gain.setValueAtTime(1, now);
		this.playPack(voice);
		this.active = voice;
		return voice;
	}

	setLayerMuted(voice: PackVoice, layerId: string, muted: boolean): void {
		const layer = voice.layers.find((l) => l.spec.id === layerId);
		if (!layer || !this.ctx) return;
		layer.muted = muted;
		this.rampLayerGain(layer);
	}

	setLayerVolume(voice: PackVoice, layerId: string, volume: number): void {
		const layer = voice.layers.find((l) => l.spec.id === layerId);
		if (!layer || !this.ctx) return;
		layer.volume = clampUnit(volume);
		this.rampLayerGain(layer);
	}

	private rampLayerGain(layer: LayerVoice): void {
		if (!this.ctx) return;
		const now = this.ctx.currentTime;
		const target = layer.muted ? 0 : layer.volume;
		layer.gain.gain.cancelScheduledValues(now);
		layer.gain.gain.setValueAtTime(layer.gain.gain.value, now);
		layer.gain.gain.linearRampToValueAtTime(target, now + PARAM_RAMP_SECONDS);
	}

	private disposeVoice(voice: PackVoice): void {
		for (const layer of voice.layers) {
			if (layer.intervalTimer !== null) this.clearTimeoutFn(layer.intervalTimer);
			try {
				layer.source?.stop();
			} catch {
				// Already stopped (a oneshot that finished on its own) - nothing to do.
			}
			layer.source?.disconnect();
			layer.gain.disconnect();
		}
		voice.packGain.disconnect();
	}

	stopAll(): void {
		if (this.active) this.disposeVoice(this.active);
		this.active = null;
		for (const voice of this.fadingOut) this.disposeVoice(voice);
		this.fadingOut.clear();
	}

	/** Fades the active pack to silence and stops it, with no incoming pack to fade into
	 * - the transition `AmbientPlayer.svelte` uses when the GM declares a place with no
	 * ambient pack generated for it yet, rather than cutting the previous place's sound
	 * off mid-waveform. Same audio-clock ramp as `crossfadeTo`'s outgoing half. */
	async stopWithFade(durationSeconds = DEFAULT_CROSSFADE_SECONDS): Promise<void> {
		const ctx = this.ensureContext();
		const outgoing = this.active;
		if (!outgoing) return;

		const now = ctx.currentTime;
		this.fadingOut.add(outgoing);
		outgoing.packGain.gain.cancelScheduledValues(now);
		outgoing.packGain.gain.setValueAtTime(outgoing.packGain.gain.value, now);
		outgoing.packGain.gain.linearRampToValueAtTime(0, now + durationSeconds);
		this.active = null;

		this.setTimeoutFn(
			() => {
				this.disposeVoice(outgoing);
				this.fadingOut.delete(outgoing);
			},
			durationSeconds * 1000 + 100
		);
	}

	/** Everything `tab.evaluate` reads back for issue #69's verification: context state,
	 * real node/gain values, and each continuous layer's actual `loop`/`loopStart`/
	 * `loopEnd`, so a claim about the scheduling can be checked against the live graph
	 * rather than trusted from the source. */
	snapshot(): EngineSnapshot {
		return {
			contextState: this.contextState,
			currentTime: this.ctx?.currentTime ?? 0,
			sampleRate: this.ctx?.sampleRate ?? null,
			masterVolume: this.master?.gain.value ?? this.masterVolumeValue,
			activePack: this.active
				? {
						id: this.active.spec.id,
						packGain: this.active.packGain.gain.value,
						layers: this.active.layers.map((layer) => ({
							id: layer.spec.id,
							loopType: layer.spec.loopType,
							muted: layer.muted,
							volume: layer.volume,
							gain: layer.gain.gain.value,
							loop: layer.source?.loop ?? false,
							loopStart: layer.source?.loopStart ?? 0,
							loopEnd: layer.source?.loopEnd ?? 0,
							bufferDurationSeconds: layer.buffer.duration
						}))
					}
				: null,
			fadingOutPackCount: this.fadingOut.size
		};
	}
}
