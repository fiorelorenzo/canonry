import { describe, expect, it } from 'vitest';
import {
	ELEVENLABS_MEASURED_CONCURRENCY_CEILING,
	ProviderLimiter,
	Semaphore,
	readProviderConcurrencyConfig
} from './concurrency.js';

/** A promise this test controls the resolution of, standing in for "the provider call is
 * still in flight" without any real wall-clock wait. */
function gate(): { promise: Promise<void>; resolve: () => void } {
	return Promise.withResolvers<void>();
}

/** Yields the microtask queue enough turns for a chain of awaits (acquire's internal
 * resolve -> run()'s await -> fn() call) to fully settle, without any real-time wait. */
async function flush(): Promise<void> {
	for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('Semaphore', () => {
	it('serialises calls beyond its limit (#70)', async () => {
		const semaphore = new Semaphore(1);
		const events: string[] = [];
		const gateA = gate();

		const taskA = semaphore.run(async () => {
			events.push('a:start');
			await gateA.promise;
			events.push('a:end');
		});

		await flush();
		expect(events).toEqual(['a:start']);

		const taskB = semaphore.run(async () => {
			events.push('b:start');
			events.push('b:end');
		});

		// B is queued behind A's single slot - it must not have started yet, no matter
		// how many microtask turns pass, until A actually releases.
		await flush();
		expect(events).toEqual(['a:start']);

		gateA.resolve();
		await taskA;
		await taskB;

		expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
	});

	it('lets up to `limit` calls run concurrently', async () => {
		const semaphore = new Semaphore(2);
		const gateA = gate();
		const gateB = gate();
		const gateC = gate();
		const started: number[] = [];

		const tasks = [gateA, gateB, gateC].map((g, i) =>
			semaphore.run(async () => {
				started.push(i);
				await g.promise;
			})
		);

		// Two slots: exactly the first two tasks should have started, the third queued.
		await flush();
		expect(started).toEqual([0, 1]);

		gateA.resolve();
		await flush();
		expect(started).toEqual([0, 1, 2]);

		gateB.resolve();
		gateC.resolve();
		await Promise.all(tasks);
	});

	it('releases the slot even when the wrapped call throws', async () => {
		const semaphore = new Semaphore(1);

		await expect(
			semaphore.run(async () => {
				throw new Error('boom');
			})
		).rejects.toThrow('boom');

		// If the failed call had leaked its slot, this second run() would hang forever
		// waiting for a slot nobody released - that is what this assertion proves against.
		let ran = false;
		await semaphore.run(async () => {
			ran = true;
		});
		expect(ran).toBe(true);
	});

	it('rejects a non-positive limit', () => {
		expect(() => new Semaphore(0)).toThrow(RangeError);
		expect(() => new Semaphore(-1)).toThrow(RangeError);
	});
});

describe('ProviderLimiter', () => {
	it('keeps replicate and elevenlabs on independent semaphores', async () => {
		const limiter = new ProviderLimiter({ replicate: 1, elevenlabs: 1 });
		const gateR = gate();
		const events: string[] = [];

		const taskR = limiter.run('replicate', async () => {
			events.push('r:start');
			await gateR.promise;
			events.push('r:end');
		});

		await flush();
		expect(events).toEqual(['r:start']);

		// elevenlabs must not queue behind replicate's slot - different providers, so it
		// starts (and finishes, since nothing gates it) immediately.
		await limiter.run('elevenlabs', async () => {
			events.push('e:start');
			events.push('e:end');
		});
		expect(events).toEqual(['r:start', 'e:start', 'e:end']);

		gateR.resolve();
		await taskR;
	});

	it('reads configured limits from the environment (#70: limits live in configuration)', () => {
		const config = readProviderConcurrencyConfig({
			MEDIA_CONCURRENCY_REPLICATE: '7',
			MEDIA_CONCURRENCY_ELEVENLABS: '2'
		} as NodeJS.ProcessEnv);
		expect(config).toEqual({ replicate: 7, elevenlabs: 2 });
	});

	it('falls back to the documented defaults on missing or invalid env values', () => {
		const config = readProviderConcurrencyConfig({
			MEDIA_CONCURRENCY_REPLICATE: 'not-a-number'
		} as NodeJS.ProcessEnv);
		expect(config.replicate).toBe(4);
		expect(config.elevenlabs).toBe(3);
	});
});

describe('the default ElevenLabs limit against the measured ceiling (#594)', () => {
	it('leaves a slot on the account when this process is at its own limit', async () => {
		// The ceiling is per ElevenLabs subscription, and preview and prod share one, so a
		// process saturating its own semaphore must still not be holding every slot the
		// account has: the one it leaves is what the other stack generates in, and what
		// keeps ElevenLabsThrottledError's retry an exceptional path rather than the normal
		// one. Driven through the real semaphore rather than compared to a literal, so it
		// is the gating that is asserted: raise the default to the ceiling and the fourth
		// call below starts, which is the failure.
		const limiter = new ProviderLimiter(readProviderConcurrencyConfig({} as NodeJS.ProcessEnv));
		const gates = Array.from({ length: ELEVENLABS_MEASURED_CONCURRENCY_CEILING }, () => gate());
		let inFlight = 0;

		const calls = gates.map((g) =>
			limiter.run('elevenlabs', async () => {
				inFlight++;
				await g.promise;
				inFlight--;
			})
		);

		await flush();
		expect(inFlight).toBeLessThan(ELEVENLABS_MEASURED_CONCURRENCY_CEILING);

		for (const g of gates) g.resolve();
		await Promise.all(calls);
		expect(inFlight).toBe(0);
	});
});
