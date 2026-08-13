/**
 * The tiny logger every gateway/usage call in this package writes through.
 *
 * SPEC 6.5 and issue #31 state the rule this package must not break: logs
 * record metadata only, never prompt or completion content, never
 * credentials. `CallLogFields` is a closed shape - no index signature, no
 * `unknown` passthrough - so there is nowhere for a prompt string to hide by
 * construction. The whitelist check in `createLogger` is a second, runtime
 * backstop against a caller widening the type with an `as` cast: any key
 * outside the approved set throws instead of being logged.
 */

export type CallLogStatus = 'ok' | 'error';

export interface CallLogFields {
	status: CallLogStatus;
	provider: string;
	modelId: string;
	purpose: string;
	agent: string;
	operation: string;
	latencyMs: number;
	inputTokens: number;
	outputTokens: number;
	embeddingTokens: number;
	credits: number;
	costEur: number;
	requestId: string | null;
	errorName: string | null;
}

const ALLOWED_KEYS: Record<string, true> = {
	status: true,
	provider: true,
	modelId: true,
	purpose: true,
	agent: true,
	operation: true,
	latencyMs: true,
	inputTokens: true,
	outputTokens: true,
	embeddingTokens: true,
	credits: true,
	costEur: true,
	requestId: true,
	errorName: true
};

export type LogSink = (fields: CallLogFields) => void;

export interface Logger {
	logCall(fields: CallLogFields): void;
}

export class ForbiddenLogFieldError extends Error {
	constructor(key: string) {
		super(
			`logger: field "${key}" is not an approved metadata field (SPEC 6.5 - metadata only, never prompt or completion content, never credentials)`
		);
		this.name = 'ForbiddenLogFieldError';
	}
}

export function createLogger(sink: LogSink): Logger {
	return {
		logCall(fields) {
			for (const key of Object.keys(fields)) {
				if (!ALLOWED_KEYS[key]) {
					throw new ForbiddenLogFieldError(key);
				}
			}
			sink(fields);
		}
	};
}

function consoleSink(fields: CallLogFields): void {
	console.log(JSON.stringify({ event: 'model_call', ...fields }));
}

/** Package-wide default logger. `withUsage` accepts an override for tests. */
export const logger: Logger = createLogger(consoleSink);
