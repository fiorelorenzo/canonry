/**
 * Per-provider concurrency limits (#70, SPEC.md §11.1: "the per-provider concurrency
 * semaphore" reused from ai-game, and §8.1's fixture "ElevenLabs at 3 concurrent
 * requests"). Every outbound provider call passes through the semaphore for its own
 * provider name right around the network call, never around a whole request - two GMs
 * generating portraits at once still queue behind Replicate's real limit, not behind each
 * other's whole HTTP round trip.
 */

export class Semaphore {
	private active = 0;
	private readonly waiters: Array<() => void> = [];

	constructor(public readonly limit: number) {
		if (!Number.isInteger(limit) || limit < 1) {
			throw new RangeError(`Semaphore limit must be a positive integer, got ${limit}`);
		}
	}

	/** Resolves once a slot is free. Call the returned function exactly once to release
	 * it - prefer run() below, which cannot forget to. */
	async acquire(): Promise<() => void> {
		if (this.active < this.limit) {
			this.active++;
			return () => this.release();
		}
		const { promise, resolve } = Promise.withResolvers<() => void>();
		this.waiters.push(() => {
			this.active++;
			resolve(() => this.release());
		});
		return promise;
	}

	private release(): void {
		this.active--;
		const next = this.waiters.shift();
		if (next) next();
	}

	/** Acquire, run, always release - even when fn() throws. */
	async run<T>(fn: () => Promise<T>): Promise<T> {
		const release = await this.acquire();
		try {
			return await fn();
		} finally {
			release();
		}
	}
}

export interface ProviderConcurrencyConfig {
	replicate: number;
	elevenlabs: number;
}

/**
 * The measured ceiling on this ElevenLabs account, taken from the refusal itself rather
 * than from documentation (issue #337, recorded in docs/models.md): the 429 body reads
 * "a maximum of 4 concurrent requests (running in parallel)". It is not a documented
 * guarantee. The account's tier is `payg`, which ElevenLabs' published per-plan
 * concurrency table does not list at all, and the endpoint sends no
 * `maximum-concurrent-requests` header, so this is an observation about one account on one
 * day. `DEFAULT_PROVIDER_CONCURRENCY.elevenlabs` below has to stay strictly under it, and
 * concurrency.test.ts asserts exactly that rather than either number on its own.
 */
export const ELEVENLABS_MEASURED_CONCURRENCY_CEILING = 4;

/**
 * SPEC.md §8.1's own fixture names ElevenLabs at 3 concurrent requests. Replicate has no
 * single published number - 4 is this package's own choice, wide enough that a couple of
 * GMs generating portraits at once do not queue behind each other, narrow enough that a
 * background warm batch (SPEC.md §8.1 trigger 2) cannot starve interactive requests. Both
 * are overridable per deployment (issue #70: "limits live in configuration"), see
 * readProviderConcurrencyConfig below.
 *
 * **ElevenLabs stays at 3 against a measured ceiling of 4, deliberately (issue #594).**
 * #337 found the real limit by hitting it, so the fixture is no longer the only thing
 * holding the 3 up, and the unused slot is a decision rather than an oversight. Three
 * reasons, in the order they bind.
 *
 * A semaphore set to the exact ceiling stops being a semaphore. The point of this limit is
 * to queue locally instead of being refused remotely; at 4 the first extra call is a 429
 * and `ElevenLabsThrottledError`'s retry becomes load-bearing for ordinary operation
 * rather than for the exceptional case it was written for.
 *
 * The ceiling belongs to an account, and two stacks share it. `preview` and `prod` on
 * prodbox carry the same `ELEVENLABS_API_KEY` value, and ElevenLabs counts concurrency per
 * subscription rather than per key, so 4 is the total for both stacks together plus any
 * bench run. At 3 the fourth slot is the other stack's floor, which is exactly one
 * in-flight generation, and `generateAmbientPack` renders a pack's layers one after
 * another, so one slot is all a quiet stack ever needs. Whether the two stacks should share
 * an account at all is a spend question and is on #594 for Lorenzo; 4 becomes safe the day
 * they stop sharing, and that day needs no code change, only
 * `MEDIA_CONCURRENCY_ELEVENLABS=4` in that stack's secrets.
 *
 * And the 4 is an observation about a `payg` account today rather than a published number
 * (see the constant above), so a limit equal to it would break silently on a plan change
 * while a limit under it degrades to queueing.
 */
export const DEFAULT_PROVIDER_CONCURRENCY: ProviderConcurrencyConfig = {
	replicate: 4,
	elevenlabs: 3
};

function readLimit(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
	const raw = env[name];
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function readProviderConcurrencyConfig(
	env: NodeJS.ProcessEnv = process.env
): ProviderConcurrencyConfig {
	return {
		replicate: readLimit(
			env,
			'MEDIA_CONCURRENCY_REPLICATE',
			DEFAULT_PROVIDER_CONCURRENCY.replicate
		),
		elevenlabs: readLimit(
			env,
			'MEDIA_CONCURRENCY_ELEVENLABS',
			DEFAULT_PROVIDER_CONCURRENCY.elevenlabs
		)
	};
}

export type ProviderName = keyof ProviderConcurrencyConfig;

/** One Semaphore per provider, built once from a config and reused for the process
 * lifetime - a fresh Semaphore per call would let every in-flight call run at once,
 * exactly what this issue exists to prevent. */
export class ProviderLimiter {
	private readonly semaphores: Map<ProviderName, Semaphore>;

	constructor(config: ProviderConcurrencyConfig = readProviderConcurrencyConfig()) {
		this.semaphores = new Map(
			(Object.entries(config) as Array<[ProviderName, number]>).map(([name, limit]) => [
				name,
				new Semaphore(limit)
			])
		);
	}

	async run<T>(provider: ProviderName, fn: () => Promise<T>): Promise<T> {
		const semaphore = this.semaphores.get(provider);
		if (!semaphore) {
			throw new Error(`ProviderLimiter: no configured limit for provider "${provider}"`);
		}
		return semaphore.run(fn);
	}
}
