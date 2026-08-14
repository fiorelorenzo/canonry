/**
 * Token bucket rate limiter (SPEC.md §7/§11.3: MediaWiki crawl "at 15 req/s"). Shared by
 * the real `MediaWikiClient` and, in tests, by the same class pointed at a local fixture
 * server - the limiter is a constructor argument either way, never hardcoded into the
 * request path, so a live crawl is a configuration choice, not a code change (issue #58).
 */
import { setTimeout as delay } from 'node:timers/promises';

export interface RateLimiter {
	/** Resolves once a slot is free; awaiting it before a request is what actually
	 * enforces the limit. */
	acquire(): Promise<void>;
}

export class TokenBucketRateLimiter implements RateLimiter {
	private tokens: number;
	private readonly capacity: number;
	private readonly refillPerMs: number;
	private lastRefillAt: number;

	constructor(requestsPerSecond: number) {
		if (requestsPerSecond <= 0) {
			throw new RangeError(`requestsPerSecond must be positive, got ${requestsPerSecond}`);
		}
		this.capacity = requestsPerSecond;
		this.tokens = requestsPerSecond;
		this.refillPerMs = requestsPerSecond / 1000;
		this.lastRefillAt = Date.now();
	}

	async acquire(): Promise<void> {
		for (;;) {
			const now = Date.now();
			const elapsedMs = now - this.lastRefillAt;
			if (elapsedMs > 0) {
				this.tokens = Math.min(this.capacity, this.tokens + elapsedMs * this.refillPerMs);
				this.lastRefillAt = now;
			}
			if (this.tokens >= 1) {
				this.tokens -= 1;
				return;
			}
			const waitMs = Math.max(1, Math.ceil((1 - this.tokens) / this.refillPerMs));
			await delay(waitMs);
		}
	}
}
