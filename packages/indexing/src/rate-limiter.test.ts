import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenBucketRateLimiter } from './rate-limiter.js';

describe('TokenBucketRateLimiter', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('rejects a non-positive rate', () => {
		expect(() => new TokenBucketRateLimiter(0)).toThrow(RangeError);
		expect(() => new TokenBucketRateLimiter(-1)).toThrow(RangeError);
	});

	it('lets an initial burst up to the configured rate through with no wait', async () => {
		const limiter = new TokenBucketRateLimiter(10);
		for (let i = 0; i < 10; i++) await limiter.acquire();
		// Nothing to assert on timing here - if any of these had to wait for a refill,
		// the call would never resolve without advancing the fake clock, and the test
		// would hang rather than pass silently.
	});

	it('throttles once the burst is exhausted, resolving only after the clock advances enough to refill a token', async () => {
		const limiter = new TokenBucketRateLimiter(5); // 200ms per token
		for (let i = 0; i < 5; i++) await limiter.acquire();

		let resolved = false;
		const sixthAcquire = limiter.acquire().then(() => {
			resolved = true;
		});

		await vi.advanceTimersByTimeAsync(0);
		expect(resolved).toBe(false);

		await vi.advanceTimersByTimeAsync(250);
		await sixthAcquire;
		expect(resolved).toBe(true);
	});

	it('refills over time: waiting between bursts avoids throttling the next burst', async () => {
		const limiter = new TokenBucketRateLimiter(5);
		for (let i = 0; i < 5; i++) await limiter.acquire();
		await vi.advanceTimersByTimeAsync(1100);

		// A full second at 5 req/s refills the whole bucket, so this second burst must
		// not need any further clock advance to complete.
		for (let i = 0; i < 5; i++) await limiter.acquire();
	});
});
