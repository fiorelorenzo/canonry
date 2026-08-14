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
 * SPEC.md §8.1's own fixture names ElevenLabs at 3 concurrent requests. Replicate has no
 * single published number - 4 is this package's own choice, wide enough that a couple of
 * GMs generating portraits at once do not queue behind each other, narrow enough that a
 * background warm batch (SPEC.md §8.1 trigger 2) cannot starve interactive requests. Both
 * are overridable per deployment (issue #70: "limits live in configuration"), see
 * readProviderConcurrencyConfig below.
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
