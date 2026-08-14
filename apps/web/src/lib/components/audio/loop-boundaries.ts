/**
 * Issue #69: "a gap or a click at the loop boundary is the defect this issue exists to
 * avoid". Web Audio's native `AudioBufferSourceNode.loop` is a hard cut from `loopEnd`
 * back to `loopStart` - if the sample amplitude differs at that wrap point, the jump is
 * an audible click. Trimming the loop points to the quietest nearby frame (with a small
 * preference for a matching slope direction, so the waveform bends the same way on both
 * sides of the seam) is the standard declick technique loop-point editors use, and it
 * works whether or not the source audio was authored with any silence at its edges -
 * `../../../../packages/media/src/audio/provider.ts`'s `tinyWavBytes` fades to silence at
 * both ends specifically so this function has something real to find in dev fixtures.
 *
 * Pure and framework-free on purpose: it operates on a `Float32Array` (one channel of a
 * decoded `AudioBuffer`), not on the `AudioBuffer` itself, so it is unit-testable under
 * plain Node with synthetic sample data - no jsdom, no Web Audio polyfill.
 */

export interface LoopBoundaries {
	/** Seconds from the start of the buffer - AudioBufferSourceNode.loopStart. */
	loopStart: number;
	/** Seconds from the start of the buffer - AudioBufferSourceNode.loopEnd. */
	loopEnd: number;
}

const DEFAULT_SEARCH_WINDOW_SECONDS = 0.05;
const CANDIDATES_PER_WINDOW = 8;
const SLOPE_MISMATCH_PENALTY = 0.01;

function slopeSign(data: Float32Array, frame: number): number {
	const prev = data[Math.max(0, frame - 1)] ?? 0;
	const next = data[Math.min(data.length - 1, frame + 1)] ?? 0;
	return Math.sign(next - prev);
}

/** The `count` quietest frame indices in `[from, to)`, ascending by |amplitude|. Ties
 * broken by frame order so the result is deterministic. */
function quietestFrames(data: Float32Array, from: number, to: number, count: number): number[] {
	const frames: number[] = [];
	for (let i = from; i < to; i++) frames.push(i);
	frames.sort((a, b) => Math.abs(data[a] ?? 0) - Math.abs(data[b] ?? 0) || a - b);
	return frames.slice(0, count);
}

/**
 * Scans a small window at each edge of `channelData` for the pair of frames (one near
 * the start, one near the end) that minimises the amplitude jump when the buffer loops
 * from the end frame back to the start frame, with a light penalty when the waveform is
 * moving in opposite directions at the two points. Falls back to the whole buffer
 * (`loopStart: 0`, `loopEnd: durationSeconds`) when it is too short for the search
 * windows to be meaningful.
 */
export function findLoopBoundaries(
	channelData: Float32Array,
	sampleRate: number,
	durationSeconds: number,
	searchWindowSeconds = DEFAULT_SEARCH_WINDOW_SECONDS
): LoopBoundaries {
	const totalFrames = channelData.length;
	const windowFrames = Math.floor(sampleRate * searchWindowSeconds);

	if (totalFrames < windowFrames * 4 || windowFrames < 1) {
		return { loopStart: 0, loopEnd: durationSeconds };
	}

	const startCandidates = quietestFrames(channelData, 0, windowFrames, CANDIDATES_PER_WINDOW);
	const endCandidates = quietestFrames(
		channelData,
		totalFrames - windowFrames,
		totalFrames,
		CANDIDATES_PER_WINDOW
	);

	let bestStart = 0;
	let bestEnd = totalFrames - 1;
	let bestCost = Number.POSITIVE_INFINITY;

	for (const start of startCandidates) {
		for (const end of endCandidates) {
			const amplitudeCost = Math.abs(channelData[start] ?? 0) + Math.abs(channelData[end] ?? 0);
			const slopePenalty =
				slopeSign(channelData, start) !== slopeSign(channelData, end) ? SLOPE_MISMATCH_PENALTY : 0;
			const cost = amplitudeCost + slopePenalty;
			if (cost < bestCost) {
				bestCost = cost;
				bestStart = start;
				bestEnd = end;
			}
		}
	}

	return { loopStart: bestStart / sampleRate, loopEnd: bestEnd / sampleRate };
}

/** Uniform random delay in seconds within an interval layer's bounds (SPEC.md §8.2,
 * `packages/media/src/audio/layers.ts`'s `intervalMinSeconds`/`intervalMaxSeconds`).
 * Falls back to a fixed 20-40s band when a layer is missing either bound, which should
 * not happen for a real `interval` layer but keeps this total rather than throwing on a
 * malformed row. */
export function randomIntervalDelaySeconds(
	minSeconds: number | undefined,
	maxSeconds: number | undefined,
	rng: () => number = Math.random
): number {
	const min = minSeconds ?? 20;
	const max = Math.max(maxSeconds ?? 40, min);
	return min + rng() * (max - min);
}

export function clampUnit(value: number): number {
	if (Number.isNaN(value)) return 0;
	return Math.min(1, Math.max(0, value));
}
