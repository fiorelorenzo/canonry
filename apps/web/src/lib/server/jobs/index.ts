// Public surface of `$lib/server/jobs`: the debounced background trigger for SPEC.md
// §5.1/§5.2 (propagation and audit "on save, debounced, in the background"). A route that
// writes a human-authored `revision` calls `scheduleCanonSaveJob`; nothing else needs the
// generic queue or the engine wiring directly.
export {
	createCanonSaveJobQueue,
	scheduleCanonSaveJob,
	recentCanonSaveJobs,
	type CanonSaveJobInput,
	type CanonSaveJobQueue,
	type CanonSaveJobResult,
	type EngineOutcome
} from './canon-save.js';

export { DebouncedJobQueue, type JobQueueHandlers, type JobQueueOptions } from './queue.js';
