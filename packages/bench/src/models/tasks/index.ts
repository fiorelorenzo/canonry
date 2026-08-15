/** Which tasks a purpose is judged on. */
import type { BenchPurpose } from '../candidates.js';
import type { BenchTask } from '../runner.js';
import { rankTask } from './rank.js';
import { auditTask } from './audit.js';
import { extractTask } from './extract.js';
import { diffTask } from './diff.js';
import { completeTask } from './complete.js';
import { askTask } from './ask.js';
import { pageTask } from './page.js';

const TASKS: Record<BenchPurpose, BenchTask[]> = {
	cheap: [rankTask, auditTask, extractTask],
	premium: [diffTask, completeTask, askTask],
	multimodal: [pageTask]
};

export function tasksFor(purpose: BenchPurpose): BenchTask[] {
	return TASKS[purpose];
}
