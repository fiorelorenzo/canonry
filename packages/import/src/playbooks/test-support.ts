/**
 * Shared scripted-model test helpers for the per-playbook tests (issue #46), mirroring
 * gateway-driver.test.ts's own builders exactly (same `MockLanguageModelV4` shape,
 * verified there against the installed `ai@7.0.65` / `@ai-sdk/provider@4.0.7` types).
 * Duplicated here rather than imported from that file because it does not export them
 * and it is not this package's file to change; six playbook tests sharing this copy
 * beats six ad hoc ones.
 */
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModel } from 'ai';
import {
	GatewayDriver,
	type GatewayWrapper,
	type ImportModel,
	type ModelSelector
} from '../gateway-driver.js';
import type { ImportJob, JobBudget, JobDocument, JobEvent } from '../driver.js';
import type { LoadedPlaybook } from '../playbook.js';
import type { SourceReader } from '../sources.js';
import { InMemoryImageStore } from '../images.js';

function usage(inputTotal: number, outputTotal: number) {
	return {
		inputTokens: {
			total: inputTotal,
			noCache: inputTotal,
			cacheRead: undefined,
			cacheWrite: undefined
		},
		outputTokens: { total: outputTotal, text: outputTotal, reasoning: undefined }
	};
}

export function toolCallStep(calls: Array<{ id: string; name: string; input: unknown }>) {
	return {
		content: calls.map((call) => ({
			type: 'tool-call' as const,
			toolCallId: call.id,
			toolName: call.name,
			input: JSON.stringify(call.input)
		})),
		finishReason: { unified: 'tool-calls' as const, raw: undefined },
		usage: usage(10, 5),
		warnings: []
	};
}

export function scriptedModel(steps: ReturnType<typeof toolCallStep>[]): MockLanguageModelV4 {
	return new MockLanguageModelV4({ provider: 'test', modelId: 'test-cheap', doGenerate: steps });
}

const TEST_PARAMS = { eurPerInputMTok: 1, eurPerOutputMTok: 2, creditsPerEur: 100 };

export function fixedModelSelector(languageModel: LanguageModel): ModelSelector {
	const resolved: ImportModel = {
		languageModel,
		provider: 'test',
		modelId: 'test-cheap',
		params: TEST_PARAMS
	};
	return { resolve: async () => resolved };
}

export const IDENTITY_GATEWAY: GatewayWrapper = (model) => model;

export async function collect(
	job: ImportJob,
	driver: GatewayDriver
): Promise<{ jobId: string; events: JobEvent[] }> {
	const stream = driver.startJob(job);
	const events: JobEvent[] = [];
	for await (const event of stream) events.push(event);
	return { jobId: stream.jobId, events };
}

export function buildJob(input: {
	id: string;
	playbook: LoadedPlaybook;
	documents: JobDocument[];
	sources: SourceReader;
	images?: InMemoryImageStore;
	budget?: JobBudget;
}): ImportJob {
	return {
		id: input.id,
		playbook: input.playbook,
		documents: input.documents,
		budget: input.budget ?? { maxCredits: 1000 },
		sources: input.sources,
		images: input.images ?? new InMemoryImageStore()
	};
}

/** Runs one document through a real playbook against a scripted model in one call,
 * since every playbook test needs the same four steps: build the driver, build the
 * job, run it, collect the events. */
export async function runScriptedDocument(input: {
	playbook: LoadedPlaybook;
	document: JobDocument;
	sources: SourceReader;
	images?: InMemoryImageStore;
	steps: ReturnType<typeof toolCallStep>[];
}): Promise<{ events: JobEvent[]; model: MockLanguageModelV4 }> {
	const model = scriptedModel(input.steps);
	const driver = new GatewayDriver({
		gateway: IDENTITY_GATEWAY,
		models: fixedModelSelector(model)
	});
	const job = buildJob({
		id: 'job-1',
		playbook: input.playbook,
		documents: [input.document],
		sources: input.sources,
		...(input.images ? { images: input.images } : {})
	});
	const { events } = await collect(job, driver);
	return { events, model };
}

/** Finds the character offset of `needle` inside `haystack` and fails loudly rather
 * than silently proposing a bogus `evidenceSpan` if the fixture text ever drifts. */
export function findSpan(haystack: string, needle: string): { start: number; end: number } {
	const start = haystack.indexOf(needle);
	if (start === -1) {
		throw new Error(`fixture text does not contain the expected span text: "${needle}"`);
	}
	return { start, end: start + needle.length };
}
