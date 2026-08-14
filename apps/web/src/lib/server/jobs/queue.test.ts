/**
 * `DebouncedJobQueue` in isolation, with an injected `execute`/`merge`/`settle` rather
 * than the real copilot engines - the debounce/dedupe/concurrency control flow this file
 * tests is generic (see `queue.ts`'s own header comment); `canon-save.test.ts` covers what
 * actually runs, against the real database and a `MockLanguageModelV4`.
 *
 * Fake timers throughout: every delay here is the queue's own debounce/backoff, never a
 * genuine I/O wait, so the clock is driven deterministically rather than guessed at with a
 * real sleep.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DebouncedJobQueue } from './queue.js';

interface Input {
	key: string;
	oldValue: number;
	newValue: number;
}

async function delay(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('DebouncedJobQueue', () => {
	it('coalesces five schedule() calls inside the debounce window into one run spanning the whole burst', async () => {
		const calls: Input[] = [];
		const queue = new DebouncedJobQueue<Input>(
			{ debounceMs: 30, maxConcurrent: 3 },
			{
				async execute(input) {
					calls.push(input);
				},
				merge: (accumulated, next) => ({ ...next, oldValue: accumulated.oldValue }),
				settle: (ranInput) => ({ ...ranInput, oldValue: ranInput.newValue })
			}
		);

		for (let i = 1; i <= 5; i++) {
			queue.schedule('e1', { key: 'e1', oldValue: i - 1, newValue: i });
			await vi.advanceTimersByTimeAsync(5);
		}
		await vi.advanceTimersByTimeAsync(30);

		expect(calls).toHaveLength(1);
		expect(calls[0]).toEqual({ key: 'e1', oldValue: 0, newValue: 5 });
		expect(queue.isIdle()).toBe(true);
	});

	it('debounces independently per key: two entities saved in the same window each get their own run', async () => {
		const calls: Input[] = [];
		const queue = new DebouncedJobQueue<Input>(
			{ debounceMs: 30, maxConcurrent: 3 },
			{
				async execute(input) {
					calls.push(input);
				},
				merge: (accumulated, next) => ({ ...next, oldValue: accumulated.oldValue }),
				settle: (ranInput) => ({ ...ranInput, oldValue: ranInput.newValue })
			}
		);

		queue.schedule('e1', { key: 'e1', oldValue: 0, newValue: 1 });
		queue.schedule('e2', { key: 'e2', oldValue: 0, newValue: 1 });
		await vi.advanceTimersByTimeAsync(30);

		expect(calls).toHaveLength(2);
		expect(calls.map((c) => c.key).sort()).toEqual(['e1', 'e2']);
	});

	it('never starts a second run for a key while one is in flight - saves during a run collapse into exactly one follow-up', async () => {
		const calls: Input[] = [];
		const queue = new DebouncedJobQueue<Input>(
			{ debounceMs: 15, maxConcurrent: 3 },
			{
				async execute(input) {
					calls.push(input);
					await delay(150);
				},
				merge: (accumulated, next) => ({ ...next, oldValue: accumulated.oldValue }),
				settle: (ranInput) => ({ ...ranInput, oldValue: ranInput.newValue })
			}
		);

		queue.schedule('e1', { key: 'e1', oldValue: 0, newValue: 1 });
		// Let the debounce elapse so the first run actually starts (and is now sitting
		// inside its own 150ms execute delay) before firing more saves during it - this
		// exercises the "already running" branch, not a second burst in the same window.
		await vi.advanceTimersByTimeAsync(15);
		expect(calls).toHaveLength(1);

		for (let i = 2; i <= 6; i++) {
			queue.schedule('e1', { key: 'e1', oldValue: i - 1, newValue: i });
			await vi.advanceTimersByTimeAsync(5);
		}
		// The first run's execute delay finishes, which starts the one queued follow-up
		// immediately, and that follow-up's own execute delay finishes too.
		await vi.advanceTimersByTimeAsync(300);

		expect(calls).toHaveLength(2);
		expect(calls[1]).toEqual({ key: 'e1', oldValue: 1, newValue: 6 });
		expect(queue.isIdle()).toBe(true);
	});

	it('caps simultaneous runs across different keys at maxConcurrent', async () => {
		let active = 0;
		let maxActive = 0;
		const queue = new DebouncedJobQueue<Input>(
			{ debounceMs: 5, maxConcurrent: 2 },
			{
				async execute() {
					active++;
					maxActive = Math.max(maxActive, active);
					await delay(40);
					active--;
				},
				merge: (_accumulated, next) => next,
				settle: (ranInput) => ranInput
			}
		);

		for (let i = 0; i < 5; i++) {
			queue.schedule(`e${i}`, { key: `e${i}`, oldValue: 0, newValue: 1 });
		}
		await vi.advanceTimersByTimeAsync(5);
		await vi.advanceTimersByTimeAsync(200);

		expect(maxActive).toBe(2);
		expect(queue.isIdle()).toBe(true);
	});
});
