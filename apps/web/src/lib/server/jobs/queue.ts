/**
 * A generic in-process, debounced, concurrency-limited job queue keyed by an arbitrary
 * string. `canon-save.ts` is the one instantiation this app needs right now (SPEC.md
 * §5.1/§5.2: propagation and audit run "on save, debounced, in the background"), but the
 * debounce/dedupe/concurrency-limiting logic has nothing to do with canon, so it lives
 * here on its own rather than tangled into the copilot wiring - a second background
 * trigger this product grows later has somewhere to plug in without re-deriving this.
 *
 * Shape mirrors `table-stream.ts`'s own in-process state (a module-level Map, one
 * process, no cross-instance fan-out) rather than inventing a new convention for holding
 * server-side state that has to survive one request but not the process: `TableEventBus`
 * keeps one bus per universe in memory because SPEC.md §12 runs one web container per
 * stack today; this keeps one debounce/run state per job key for the same reason, and for
 * the same reason it is not durable across a restart.
 *
 * That is a real limit, not a decision this file hides: a horizontally-scaled deployment
 * (more than one web replica) needs a durable, shared queue - a Postgres-backed job table
 * a worker polls, or a real broker - so that debounce coalescing and the concurrency cap
 * apply across the whole fleet instead of once per replica, each blind to what the others
 * are doing. Until this product runs more than one web container, this is the honest,
 * unglamorous version of "on save, debounced, in the background."
 */

export interface JobQueueOptions {
	/** Quiet period after the last `schedule()` call for a key before its job runs. A few
	 * seconds is long enough to coalesce a burst of saves from one person typing and short
	 * enough that "in the background" still feels prompt (SPEC.md §5.1/§5.2 says only
	 * "debounced", not a number). */
	debounceMs: number;
	/** Hard cap on how many jobs run at once across every key in this queue - the explicit
	 * concurrency limit a background runner needs so a burst of saves across many entities
	 * cannot fan out into an unbounded number of simultaneous premium-model calls. */
	maxConcurrent: number;
}

export interface JobQueueHandlers<TInput> {
	/** Runs one job. Must never let a rejection escape - this is a fire-and-forget
	 * background caller with nobody to hand a rejection to, so a caller that lets one
	 * through gets it swallowed by `runWithSlot`'s defensive catch, silently, which is
	 * worse than handling it. `canon-save.ts`'s executor catches each engine call itself
	 * and records the outcome instead of relying on that fallback. */
	execute(input: TInput): Promise<void>;
	/** Combines a newer call's input into whatever is still accumulating for a burst still
	 * inside its debounce window, or still running. Lets each instantiation decide what
	 * "the latest state" means for its own input shape - `canon-save.ts` keeps the burst's
	 * original `oldBody` and only ever advances `newBody`, so five saves in a row diff the
	 * body from before the first one against the body after the last one, not five
	 * one-save-each diffs. */
	merge(accumulated: TInput, next: TInput): TInput;
	/** Called the moment a run actually starts, to reset the baseline anything arriving
	 * *during* that run should build on. Without this, a save landing while a run is in
	 * flight would merge onto the pre-run baseline, and the follow-up run would re-diff
	 * territory the running job already covered. */
	settle(ranInput: TInput): TInput;
}

interface KeyState<TInput> {
	timer: NodeJS.Timeout | undefined;
	input: TInput;
	running: boolean;
	rerunPending: boolean;
}

async function delay(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}

export class DebouncedJobQueue<TInput> {
	private readonly keys = new Map<string, KeyState<TInput>>();
	private readonly waiters: Array<() => void> = [];
	private activeCount = 0;

	constructor(
		private readonly options: JobQueueOptions,
		private readonly handlers: JobQueueHandlers<TInput>
	) {}

	/** Coalesces on `key`: every call inside the debounce window collapses into one job
	 * covering the whole burst. A call that lands while a job for this key is already
	 * running (or already queued for a concurrency slot) never starts a second one for
	 * that key - it marks exactly one follow-up, however many calls arrive before the
	 * running job finishes. */
	schedule(key: string, input: TInput): void {
		const existing = this.keys.get(key);
		if (!existing) {
			const state: KeyState<TInput> = {
				timer: undefined,
				input,
				running: false,
				rerunPending: false
			};
			state.timer = setTimeout(() => this.onDebounceElapsed(key), this.options.debounceMs);
			this.keys.set(key, state);
			return;
		}
		existing.input = this.handlers.merge(existing.input, input);
		clearTimeout(existing.timer);
		existing.timer = setTimeout(() => this.onDebounceElapsed(key), this.options.debounceMs);
	}

	private onDebounceElapsed(key: string): void {
		const state = this.keys.get(key);
		if (!state) return;
		state.timer = undefined;
		if (state.running) {
			// A job for this key is already running (or already committed to a concurrency
			// slot) - do not start a second one. One follow-up, regardless of how many times
			// this branch is hit before that job finishes.
			state.rerunPending = true;
			return;
		}
		this.startRun(key, state);
	}

	private startRun(key: string, state: KeyState<TInput>): void {
		state.running = true;
		const input = state.input;
		// Reset the baseline now, not when the run finishes: anything scheduled while this
		// run is executing should build on what this run is *about* to account for, not on
		// the whole history back to the start of the previous burst.
		state.input = this.handlers.settle(input);

		void this.runWithSlot(input).finally(() => {
			state.running = false;
			if (state.rerunPending) {
				state.rerunPending = false;
				this.startRun(key, state);
				return;
			}
			// Fully settled: drop the key rather than let the map grow with every entity
			// ever saved once. The next save for this entity starts a clean burst from its
			// own oldBody, exactly like the very first save for it would.
			if (this.keys.get(key) === state) this.keys.delete(key);
		});
	}

	private async runWithSlot(input: TInput): Promise<void> {
		await this.acquireSlot();
		try {
			await this.handlers.execute(input);
		} catch {
			// Defensive only - `execute` is documented to catch its own errors. A throw here
			// would be an unhandled rejection with nobody left to catch it.
		} finally {
			this.releaseSlot();
		}
	}

	private acquireSlot(): Promise<void> {
		if (this.activeCount < this.options.maxConcurrent) {
			this.activeCount++;
			return Promise.resolve();
		}
		const { promise, resolve } = Promise.withResolvers<void>();
		this.waiters.push(() => {
			this.activeCount++;
			resolve();
		});
		return promise;
	}

	private releaseSlot(): void {
		this.activeCount--;
		const next = this.waiters.shift();
		if (next) next();
	}

	/** True once every key has settled: no pending debounce timers, no runs in flight, no
	 * queued follow-up, nobody waiting on a concurrency slot. Production code never calls
	 * this - the whole point of the queue is that nobody waits on it - but a test that
	 * schedules a burst needs a way to know the burst is fully done. */
	isIdle(): boolean {
		return this.keys.size === 0 && this.activeCount === 0 && this.waiters.length === 0;
	}

	/** Test-only: polls `isIdle()` rather than wiring a bespoke completion event onto a
	 * queue whose entire production contract is fire-and-forget. */
	async waitForIdle(timeoutMs = 5000): Promise<void> {
		const start = Date.now();
		while (!this.isIdle()) {
			if (Date.now() - start > timeoutMs) {
				throw new Error(`DebouncedJobQueue.waitForIdle: still not idle after ${timeoutMs}ms`);
			}
			await delay(10);
		}
	}
}
