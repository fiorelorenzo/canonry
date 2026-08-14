// Public surface of `$lib/server/jobs`: the durable background trigger for SPEC.md
// §5.1/§5.2 (propagation and audit "on save, debounced, in the background", now backed by
// Postgres rather than one process's memory - issue #115). A route that writes a
// human-authored `revision` calls `scheduleCanonSaveJob`; nothing else needs the poller,
// the store, or the engine wiring directly.
export {
	createCanonSaveJobQueue,
	scheduleCanonSaveJob,
	recentCanonSaveJobs,
	startCanonSaveJobWorker,
	type JobQueueOptions,
	type CanonSaveJobQueueOptions,
	type CanonSaveJobInput,
	type CanonSaveJobQueue,
	type CanonSaveJobResult,
	type EngineOutcome
} from './canon-save.js';

export { DurableJobPoller, type DurableQueueHandlers, type DurableQueueOptions } from './queue.js';
