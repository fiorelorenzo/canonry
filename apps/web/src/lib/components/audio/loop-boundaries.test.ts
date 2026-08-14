import { describe, expect, it } from 'vitest';
import { clampUnit, findLoopBoundaries, randomIntervalDelaySeconds } from './loop-boundaries';

const SAMPLE_RATE = 8000;

/** A sine tone with a short linear fade in/out at both edges, mirroring
 * `packages/media/src/audio/provider.ts`'s `tinyWavBytes` exactly - the real fixture
 * this engine plays in the browser verification. */
function fadedTone(
	durationSeconds: number,
	frequencyHz: number,
	fadeSeconds: number
): Float32Array {
	const frameCount = Math.round(SAMPLE_RATE * durationSeconds);
	const fadeFrames = Math.round(SAMPLE_RATE * fadeSeconds);
	const data = new Float32Array(frameCount);
	for (let i = 0; i < frameCount; i++) {
		const t = i / SAMPLE_RATE;
		let amplitude = 0.8;
		if (i < fadeFrames) amplitude *= i / fadeFrames;
		else if (i > frameCount - fadeFrames) amplitude *= (frameCount - i) / fadeFrames;
		data[i] = Math.sin(2 * Math.PI * frequencyHz * t) * amplitude;
	}
	return data;
}

/** A full-amplitude tone with no fade - the edges are loud, not silent, so a naive
 * `loopStart: 0, loopEnd: duration` boundary is only clean if the frequency happens to
 * complete whole cycles, which this one deliberately does not. */
function abruptTone(durationSeconds: number, frequencyHz: number): Float32Array {
	const frameCount = Math.round(SAMPLE_RATE * durationSeconds);
	const data = new Float32Array(frameCount);
	for (let i = 0; i < frameCount; i++) {
		data[i] = Math.sin((2 * Math.PI * frequencyHz * i) / SAMPLE_RATE) * 0.8;
	}
	return data;
}

describe('findLoopBoundaries', () => {
	it('finds a near-silent wrap point inside the search window of a faded tone', () => {
		const data = fadedTone(0.3, 440, 0.01);
		const bounds = findLoopBoundaries(data, SAMPLE_RATE, 0.3);

		// Both points fall inside the default 50ms search window at each edge...
		expect(bounds.loopStart).toBeGreaterThanOrEqual(0);
		expect(bounds.loopStart).toBeLessThanOrEqual(0.05);
		expect(bounds.loopEnd).toBeGreaterThanOrEqual(0.25);
		expect(bounds.loopEnd).toBeLessThanOrEqual(0.3);

		// ...and are close enough to a true zero crossing that the wrap is inaudible -
		// far below the tone's 0.8 peak amplitude.
		const startFrame = Math.round(bounds.loopStart * SAMPLE_RATE);
		const endFrame = Math.round(bounds.loopEnd * SAMPLE_RATE);
		expect(Math.abs(data[startFrame] ?? 0)).toBeLessThan(0.05);
		expect(Math.abs(data[endFrame] ?? 0)).toBeLessThan(0.05);
	});

	it('reduces the wrap-point amplitude jump compared to a naive whole-buffer loop', () => {
		const data = abruptTone(0.3, 437);
		const naiveJump = Math.abs((data[0] ?? 0) - (data[data.length - 1] ?? 0));

		const bounds = findLoopBoundaries(data, SAMPLE_RATE, 0.3);
		const startFrame = Math.round(bounds.loopStart * SAMPLE_RATE);
		const endFrame = Math.round(bounds.loopEnd * SAMPLE_RATE);
		const foundJump = Math.abs((data[startFrame] ?? 0) - (data[endFrame] ?? 0));

		expect(foundJump).toBeLessThan(naiveJump);
	});

	it('falls back to the whole buffer when it is too short for the search window', () => {
		const data = new Float32Array(10).fill(0.5);
		const bounds = findLoopBoundaries(data, SAMPLE_RATE, 10 / SAMPLE_RATE);
		expect(bounds).toEqual({ loopStart: 0, loopEnd: 10 / SAMPLE_RATE });
	});

	it('is deterministic for the same input', () => {
		const data = abruptTone(0.3, 523);
		const first = findLoopBoundaries(data, SAMPLE_RATE, 0.3);
		const second = findLoopBoundaries(data, SAMPLE_RATE, 0.3);
		expect(first).toEqual(second);
	});
});

describe('randomIntervalDelaySeconds', () => {
	it('stays within the layer-declared bounds', () => {
		for (let i = 0; i < 200; i++) {
			const delay = randomIntervalDelaySeconds(15, 45, Math.random);
			expect(delay).toBeGreaterThanOrEqual(15);
			expect(delay).toBeLessThanOrEqual(45);
		}
	});

	it('is driven by the injected rng, not the global one', () => {
		expect(randomIntervalDelaySeconds(10, 20, () => 0)).toBe(10);
		expect(randomIntervalDelaySeconds(10, 20, () => 1)).toBe(20);
		expect(randomIntervalDelaySeconds(10, 20, () => 0.5)).toBe(15);
	});

	it('falls back to a fixed band when a bound is missing, never throwing', () => {
		const delay = randomIntervalDelaySeconds(undefined, undefined, () => 0.5);
		expect(delay).toBe(30);
	});
});

describe('clampUnit', () => {
	it('clamps to [0, 1] and treats NaN as 0', () => {
		expect(clampUnit(-0.5)).toBe(0);
		expect(clampUnit(1.5)).toBe(1);
		expect(clampUnit(0.42)).toBe(0.42);
		expect(clampUnit(Number.NaN)).toBe(0);
	});
});
