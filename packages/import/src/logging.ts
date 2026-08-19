/**
 * The metadata-only logger for the bounded loop (issue #31, SPEC.md §6.5, §11.2).
 * Borrowed from pitchbox even without its agent process: "logs record metadata only,
 * never file content and never credentials... worth keeping verbatim, with the test
 * that enforces it." It matters more here than it does for @canonry/ai's model-call
 * logger (packages/ai/src/logger.ts, same rule, same shape) because the content this
 * loop handles is somebody's unpublished campaign, not a generic prompt.
 *
 * `LoopLogFields` is a closed shape - no index signature, no `unknown` passthrough - so
 * a document's text, a proposed entity's name, a tool call's raw input, or a model's
 * raw output have nowhere to hide by construction: none of those are fields on this
 * type. `createLoopLogger`'s whitelist check is a second, runtime backstop against a
 * caller widening the type with an `as` cast.
 */

export type LoopLogStatus = 'ok' | 'error';

export type LoopLogEvent =
	| 'step'
	| 'step_retry'
	| 'tool_call'
	| 'checkpoint'
	| 'document_finished'
	| 'document_step_ceiling'
	| 'job_cancelled'
	| 'budget_ceiling';

export interface LoopLogFields {
	event: LoopLogEvent;
	status: LoopLogStatus;
	jobId: string;
	documentId: string;
	playbookId: string;
	playbookVersion: number;
	step: number;
	/** Which of the SPEC.md §6.3 tools this entry is about, or null for a job/step-level entry. */
	toolName: string | null;
	latencyMs: number;
	errorName: string | null;
}

const ALLOWED_KEYS: Record<string, true> = {
	event: true,
	status: true,
	jobId: true,
	documentId: true,
	playbookId: true,
	playbookVersion: true,
	step: true,
	toolName: true,
	latencyMs: true,
	errorName: true
};

export type LoopLogSink = (fields: LoopLogFields) => void;

export interface LoopLogger {
	log(fields: LoopLogFields): void;
}

export class ForbiddenLoopLogFieldError extends Error {
	constructor(key: string) {
		super(
			`import loop logger: field "${key}" is not an approved metadata field ` +
				`(SPEC 6.5, issue #31 - metadata only, never file content, never a prompt, never a credential)`
		);
		this.name = 'ForbiddenLoopLogFieldError';
	}
}

export function createLoopLogger(sink: LoopLogSink): LoopLogger {
	return {
		log(fields) {
			for (const key of Object.keys(fields)) {
				if (!ALLOWED_KEYS[key]) throw new ForbiddenLoopLogFieldError(key);
			}
			sink(fields);
		}
	};
}

function consoleSink(fields: LoopLogFields): void {
	console.log(JSON.stringify({ channel: 'import_loop', ...fields }));
}

/** Package-wide default logger. `GatewayDriver` accepts an override for tests. */
export const loopLogger: LoopLogger = createLoopLogger(consoleSink);
