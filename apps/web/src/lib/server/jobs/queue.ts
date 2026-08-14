/**
 * Generic poll/claim/lease loop (issue #115). This is the durable replacement for the
 * `DebouncedJobQueue` that used to live here: a per-key debounce timer and an in-flight
 * set held in one process's memory, correct for a single container but silently losing a
 * run on restart and unable to coalesce across two instances behind a proxy.
 *
 * The debounce window, the coalescing and the lease are not this file's job any more -
 * they live in Postgres (`canon-save.ts`'s `store.ts`: `run_after`, the partial unique
 * index on a pending row's key, `lease_holder`/`lease_expires_at`), because that is what
 * makes them authoritative across every instance instead of per-process. What is left
 * here is domain-agnostic on purpose, same as the file it replaces: ask a store for the
 * next due row, run it, repeat, never more than `maxConcurrent` at once. A second durable
 * trigger this product grows later has somewhere to plug in without re-deriving that loop
 * - it only has to bring its own `DurableQueueHandlers`.
 */
import { randomUUID } from 'node:crypto';

export interface DurableQueueOptions {
	/** How often an idle worker polls for the next due row, once nothing is claimable
	 * right now. Independent of the debounce window a store enforces - this only affects
	 * how promptly a job is picked up after it actually becomes due. */
	pollIntervalMs: number;
	/** Hard cap on simultaneous runs in this process - the same concurrency limit the
	 * in-memory queue enforced, now per-instance rather than global (each instance polls
	 * for its own share of whatever is due). */
	maxConcurrent: number;
}

export interface DurableQueueHandlers<TRow> {
	/** Atomically claims and leases the next due row, or `null` when nothing is claimable
	 * right now. Also responsible for dead-lettering a row whose attempt cap is already
	 * exhausted instead of ever handing it out again - see `store.ts`'s
	 * `claimNextCanonSaveJob` for what "due" and "exhausted" mean for this app's one
	 * durable queue. */
	claimNext(leaseHolder: string): Promise<TRow | null>;
	/** Runs one claimed row to completion, including recording its own outcome. Must
	 * never let a rejection escape - this is a fire-and-forget background loop with
	 * nobody to hand a rejection to, same contract the old in-memory queue's `execute`
	 * had. */
	run(row: TRow): Promise<void>;
}

async function delay(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}

/** One instance polls with one lease identity (`id`) - the value a reclaimed row's
 * previous `lease_holder` names in `psql`, and the value this instance's own claims carry
 * while they are running. */
export class DurableJobPoller<TRow> {
	private readonly leaseHolder = randomUUID();
	private activeCount = 0;
	private stopping = false;
	private loop: Promise<void> | undefined;

	constructor(
		private readonly options: DurableQueueOptions,
		private readonly handlers: DurableQueueHandlers<TRow>
	) {}

	get id(): string {
		return this.leaseHolder;
	}

	/** Idempotent: a second call while already running is a no-op. */
	start(): void {
		if (this.loop) return;
		this.stopping = false;
		this.loop = this.runLoop();
	}

	/** Graceful shutdown: stops claiming new rows and waits for whatever this instance
	 * already has in flight to actually finish. Standing in for a real process exit
	 * (which the "kill your dev server mid-run" verification instead does for real) - a
	 * genuine crash never gets to run this, which is exactly the case the lease exists
	 * for. */
	async stop(): Promise<void> {
		this.stopping = true;
		await this.loop;
		this.loop = undefined;
		while (this.activeCount > 0) await delay(10);
	}

	private async runLoop(): Promise<void> {
		while (!this.stopping) {
			if (this.activeCount >= this.options.maxConcurrent) {
				await delay(this.options.pollIntervalMs);
				continue;
			}
			const row = await this.handlers.claimNext(this.leaseHolder);
			if (!row) {
				await delay(this.options.pollIntervalMs);
				continue;
			}
			this.activeCount++;
			void this.handlers.run(row).finally(() => {
				this.activeCount--;
			});
		}
	}
}
