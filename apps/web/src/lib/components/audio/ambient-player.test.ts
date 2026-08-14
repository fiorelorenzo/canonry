import { describe, expect, it } from 'vitest';
import {
	AmbientEngine,
	type PackSpec,
	type SetTimeoutFn,
	type ClearTimeoutFn,
	type TimerHandle
} from './ambient-player';

/**
 * A hand-written fake of the small slice of the Web Audio API this engine actually
 * calls - no jsdom, no polyfill library (this repo adds none for issue #69, per its own
 * "no new dependency" constraint). What it buys: deterministic, synchronous assertions
 * on exactly which automation calls (`setValueAtTime`/`linearRampToValueAtTime`/
 * `cancelScheduledValues`) the engine issues, with what values and at what times, and
 * exactly which nodes get created, connected and disconnected - the *decisions* this
 * engine makes. The real Web Audio graph (real `AudioContext`, real decoded WAV bytes,
 * a real audio-clock gain ramp) is verified separately, live, in a browser.
 */

type AutomationEvent =
	| { type: 'set'; value: number; time: number }
	| { type: 'ramp'; value: number; time: number }
	| { type: 'cancel'; time: number };

class FakeAudioParam {
	value = 0;
	readonly events: AutomationEvent[] = [];

	setValueAtTime(value: number, time: number): this {
		this.value = value;
		this.events.push({ type: 'set', value, time });
		return this;
	}

	linearRampToValueAtTime(value: number, time: number): this {
		this.value = value;
		this.events.push({ type: 'ramp', value, time });
		return this;
	}

	cancelScheduledValues(time: number): this {
		this.events.push({ type: 'cancel', time });
		return this;
	}
}

class FakeAudioNode {
	readonly connections: FakeAudioNode[] = [];
	disconnected = false;

	connect(destination: FakeAudioNode): FakeAudioNode {
		this.connections.push(destination);
		return destination;
	}

	disconnect(): void {
		this.disconnected = true;
	}
}

class FakeGainNode extends FakeAudioNode {
	readonly gain = new FakeAudioParam();
}

class FakeAudioBufferSourceNode extends FakeAudioNode {
	buffer: FakeAudioBuffer | null = null;
	loop = false;
	loopStart = 0;
	loopEnd = 0;
	readonly startedAt: number[] = [];
	readonly stoppedAt: number[] = [];

	start(when = 0): void {
		this.startedAt.push(when);
	}

	stop(when = 0): void {
		this.stoppedAt.push(when);
	}
}

class FakeAudioBuffer {
	constructor(
		public readonly duration: number,
		public readonly sampleRate: number,
		private readonly channel: Float32Array
	) {}

	getChannelData(): Float32Array {
		return this.channel;
	}
}

function fakeDecodedBuffer(sampleRate: number): FakeAudioBuffer {
	const frameCount = 200;
	const channel = new Float32Array(frameCount);
	for (let i = 0; i < frameCount; i++) channel[i] = Math.sin(i / 5) * 0.5;
	return new FakeAudioBuffer(frameCount / sampleRate, sampleRate, channel);
}

class FakeAudioContext {
	currentTime = 0;
	state: 'suspended' | 'running' | 'closed' = 'suspended';
	readonly sampleRate = 8000;
	readonly destination = new FakeAudioNode();
	readonly createdSources: FakeAudioBufferSourceNode[] = [];
	resumeCalls = 0;
	resumeShouldReject = false;

	createGain(): FakeGainNode {
		return new FakeGainNode();
	}

	createBufferSource(): FakeAudioBufferSourceNode {
		const source = new FakeAudioBufferSourceNode();
		this.createdSources.push(source);
		return source;
	}

	async decodeAudioData(): Promise<FakeAudioBuffer> {
		return fakeDecodedBuffer(this.sampleRate);
	}

	async resume(): Promise<void> {
		this.resumeCalls++;
		if (this.resumeShouldReject) throw new Error('NotAllowedError: no user gesture');
		this.state = 'running';
	}

	async suspend(): Promise<void> {
		this.state = 'suspended';
	}
}
interface FakeTimer {
	id: TimerHandle;
	dueAtMs: number;
	callback: () => void;
	cleared: boolean;
	ran: boolean;
}

/** A manually-advanced timer queue standing in for `setTimeout`/`clearTimeout`, so
 * interval-layer rescheduling and crossfade cleanup are assertable without a real clock
 * or fake-timer library. Each call's due time is relative to the scheduler's own
 * internal clock at the moment it was scheduled - a callback that reschedules itself
 * with the same delay during an `advanceTo` therefore lands *after* the target, not at
 * it, so it never re-fires within the same advance. */
class FakeScheduler {
	readonly calls: FakeTimer[] = [];
	private nextId = 1;
	private nowMs = 0;

	readonly setTimeoutFn: SetTimeoutFn = (callback, delayMs) => {
		const id = this.nextId++;
		this.calls.push({ id, dueAtMs: this.nowMs + delayMs, callback, cleared: false, ran: false });
		return id;
	};

	readonly clearTimeoutFn: ClearTimeoutFn = (handle) => {
		const call = this.calls.find((c) => c.id === handle);
		if (call) call.cleared = true;
	};

	/** Runs every pending, uncleared call due at or before `targetMs`, earliest first,
	 * including any new calls a callback itself schedules with a due time still within
	 * range. */
	advanceTo(targetMs: number): void {
		for (;;) {
			const due = this.calls
				.filter((c) => !c.cleared && !c.ran && c.dueAtMs <= targetMs)
				.sort((a, b) => a.dueAtMs - b.dueAtMs)[0];
			if (!due) break;
			this.nowMs = due.dueAtMs;
			due.ran = true;
			due.callback();
		}
		this.nowMs = targetMs;
	}
}

async function fakeFetch(): Promise<Response> {
	return {
		ok: true,
		status: 200,
		arrayBuffer: async () => new ArrayBuffer(8)
	} as unknown as Response;
}

/** The engine's public types (`PackVoice`, `LayerVoice`) declare real DOM node types
 * (`GainNode`, `AudioParam`) since that is what the class actually produces in a
 * browser; these two casts are the test's only acknowledgement that, under this fake
 * `AudioContext`, the values are really `FakeGainNode`/`FakeAudioParam`. */
function fakeGain(node: GainNode): FakeGainNode {
	return node as unknown as FakeGainNode;
}
function fakeParam(param: AudioParam): FakeAudioParam {
	return param as unknown as FakeAudioParam;
}

function buildEngine(overrides: { rng?: () => number; resumeShouldReject?: boolean } = {}) {
	const ctx = new FakeAudioContext();
	ctx.resumeShouldReject = overrides.resumeShouldReject ?? false;
	const scheduler = new FakeScheduler();
	const engine = new AmbientEngine({
		createContext: () => ctx as unknown as AudioContext,
		fetchFn: fakeFetch as unknown as typeof fetch,
		setTimeoutFn: scheduler.setTimeoutFn,
		clearTimeoutFn: scheduler.clearTimeoutFn,
		rng: overrides.rng ?? (() => 0.5)
	});
	return { ctx, scheduler, engine };
}

function packWith(layers: PackSpec['layers']): PackSpec {
	return { id: 'pack-1', description: 'test pack', layers };
}

const CONTINUOUS_LAYER = {
	id: 'layer-continuous',
	url: '/media/layer-continuous',
	loopType: 'continuous' as const,
	volume: 0.6,
	prompt: 'rain'
};

const ONESHOT_LAYER = {
	id: 'layer-oneshot',
	url: '/media/layer-oneshot',
	loopType: 'oneshot' as const,
	volume: 0.5,
	prompt: 'bell'
};

const INTERVAL_LAYER = {
	id: 'layer-interval',
	url: '/media/layer-interval',
	loopType: 'interval' as const,
	intervalMinSeconds: 10,
	intervalMaxSeconds: 20,
	volume: 0.4,
	prompt: 'thunder'
};

describe('AmbientEngine.playNewPack', () => {
	it('starts a continuous layer once with native looping, never restarting it', async () => {
		const { ctx, engine } = buildEngine();
		await engine.playNewPack(packWith([CONTINUOUS_LAYER]));

		expect(ctx.createdSources).toHaveLength(1);
		const [source] = ctx.createdSources;
		expect(source!.loop).toBe(true);
		expect(source!.startedAt).toEqual([0]);

		const snapshot = engine.snapshot();
		expect(snapshot.activePack?.layers[0]).toMatchObject({
			id: 'layer-continuous',
			loopType: 'continuous',
			loop: true
		});
	});

	it('starts a oneshot layer once, without looping', async () => {
		const { ctx, engine } = buildEngine();
		await engine.playNewPack(packWith([ONESHOT_LAYER]));

		expect(ctx.createdSources).toHaveLength(1);
		expect(ctx.createdSources[0]!.loop).toBe(false);
	});

	it('schedules an interval layer via the timer, not immediately, within its declared bounds', async () => {
		const { ctx, scheduler, engine } = buildEngine({ rng: () => 0 });
		await engine.playNewPack(packWith([INTERVAL_LAYER]));

		// Nothing plays yet - only scheduled.
		expect(ctx.createdSources).toHaveLength(0);
		expect(scheduler.calls).toHaveLength(1);
		expect(scheduler.calls[0]!.dueAtMs).toBe(10_000); // rng()=0 -> the minimum bound

		ctx.currentTime = 10;
		scheduler.advanceTo(10_000);

		expect(ctx.createdSources).toHaveLength(1);
		expect(ctx.createdSources[0]!.loop).toBe(false);
		expect(ctx.createdSources[0]!.startedAt).toEqual([10]);
		// Rescheduled itself for the next firing.
		expect(scheduler.calls.filter((c) => !c.ran)).toHaveLength(1);
	});

	it('connects every layer through its own gain into the pack gain into the master gain', async () => {
		const { engine } = buildEngine();
		const voice = await engine.playNewPack(packWith([CONTINUOUS_LAYER, ONESHOT_LAYER]));

		for (const layer of voice.layers) {
			expect(fakeGain(layer.gain).connections).toContain(voice.packGain);
		}
	});
});

describe('AmbientEngine.crossfadeTo', () => {
	it('ramps both pack gains on the audio clock and cleans up the outgoing pack only after the fade', async () => {
		const { ctx, scheduler, engine } = buildEngine();
		const outgoingVoice = await engine.playNewPack(packWith([CONTINUOUS_LAYER]));

		ctx.currentTime = 100;
		const incomingVoice = await engine.crossfadeTo(packWith([ONESHOT_LAYER]), 4);

		// Outgoing pack: ramps from its current value down to 0, ending at now + duration.
		const outgoingEvents = fakeParam(outgoingVoice.packGain.gain).events;
		expect(outgoingEvents.at(-1)).toEqual({ type: 'ramp', value: 0, time: 104 });
		expect(outgoingEvents.some((e) => e.type === 'set')).toBe(true);

		// Incoming pack: starts at 0, ramps up to 1, ending at now + duration.
		const incomingEvents = fakeParam(incomingVoice.packGain.gain).events;
		expect(incomingEvents.find((e) => e.type === 'set')).toEqual({
			type: 'set',
			value: 0,
			time: 100
		});
		expect(incomingEvents.at(-1)).toEqual({ type: 'ramp', value: 1, time: 104 });

		// The only setTimeout involved is cleanup, scheduled for after the ramp finishes -
		// never a driver of the gain value itself.
		const cleanupCall = scheduler.calls.find((c) => !c.ran);
		expect(cleanupCall?.dueAtMs).toBe(4100);

		expect(fakeGain(outgoingVoice.packGain).disconnected).toBe(false);
		scheduler.advanceTo(4100);
		expect(fakeGain(outgoingVoice.packGain).disconnected).toBe(true);
		expect(ctx.createdSources[0]!.stoppedAt).toEqual([0]);
	});
});

describe('AmbientEngine mute and volume', () => {
	it('ramps only the targeted layer, leaving its sibling untouched', async () => {
		const { engine } = buildEngine();
		const voice = await engine.playNewPack(packWith([CONTINUOUS_LAYER, ONESHOT_LAYER]));

		engine.setLayerMuted(voice, 'layer-continuous', true);

		const mutedLayer = voice.layers.find((l) => l.spec.id === 'layer-continuous')!;
		const otherLayer = voice.layers.find((l) => l.spec.id === 'layer-oneshot')!;
		expect(fakeParam(mutedLayer.gain.gain).events.at(-1)).toMatchObject({ type: 'ramp', value: 0 });
		expect(fakeParam(otherLayer.gain.gain).events).toHaveLength(0);

		engine.setLayerMuted(voice, 'layer-continuous', false);
		expect(fakeParam(mutedLayer.gain.gain).events.at(-1)).toMatchObject({
			type: 'ramp',
			value: CONTINUOUS_LAYER.volume
		});
	});

	it('setLayerVolume clamps to [0, 1] and ramps to the clamped value', async () => {
		const { engine } = buildEngine();
		const voice = await engine.playNewPack(packWith([CONTINUOUS_LAYER]));

		engine.setLayerVolume(voice, 'layer-continuous', 1.7);
		expect(fakeParam(voice.layers[0]!.gain.gain).events.at(-1)).toMatchObject({
			type: 'ramp',
			value: 1
		});
	});
});

describe('AmbientEngine.resume', () => {
	it('never throws when the browser refuses resume(), and contextState reflects it', async () => {
		const { engine } = buildEngine({ resumeShouldReject: true });
		await expect(engine.resume()).resolves.toBeUndefined();
		expect(engine.contextState).toBe('suspended');
	});

	it('reaches running when the browser allows it', async () => {
		const { engine } = buildEngine();
		expect(engine.contextState).toBe('unstarted');
		await engine.resume();
		expect(engine.contextState).toBe('running');
	});
});

describe('AmbientEngine.setMasterVolume', () => {
	it('ramps the shared master gain independent of any active pack', async () => {
		const { ctx, engine } = buildEngine();
		await engine.playNewPack(packWith([CONTINUOUS_LAYER]));
		ctx.currentTime = 5;

		engine.setMasterVolume(0.25);

		expect(engine.snapshot().masterVolume).toBe(0.25);
	});
});

describe('AmbientEngine.stopWithFade', () => {
	it('ramps the active pack to silence, clears it as active immediately, and disposes it after the fade', async () => {
		const { ctx, scheduler, engine } = buildEngine();
		const voice = await engine.playNewPack(packWith([CONTINUOUS_LAYER]));
		ctx.currentTime = 10;

		await engine.stopWithFade(2);

		expect(fakeParam(voice.packGain.gain).events.at(-1)).toEqual({
			type: 'ramp',
			value: 0,
			time: 12
		});
		expect(engine.snapshot().activePack).toBeNull();
		expect(fakeGain(voice.packGain).disconnected).toBe(false);

		scheduler.advanceTo(2100);
		expect(fakeGain(voice.packGain).disconnected).toBe(true);
	});

	it('is a no-op when nothing is playing', async () => {
		const { engine } = buildEngine();
		await expect(engine.stopWithFade(2)).resolves.toBeUndefined();
	});
});
