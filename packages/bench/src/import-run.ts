/**
 * Running one real import, in process, against the built corpus.
 *
 * Shared by the model bench's `extract` task and by the end-to-end import runner, because
 * they want the same thing and disagreeing about it would be a bug: the real
 * `GatewayDriver`, the real playbook, the real tool surface, the real archive reader with
 * its real limits. Nothing here is a stand-in for anything.
 *
 * The one thing this does not use is `packages/import`'s `ImportJobRunner`. That layer
 * adds job rows, checkpoints, quota admission and the merge engine, all of which the
 * end-to-end runner exercises separately and none of which says anything about how well a
 * model reads a document. So the model bench drives the driver directly and the end-to-end
 * runner drives the job runner, and both are honest about which one they are.
 */
import { readFileSync } from 'node:fs';
import {
	ArchiveSourceReader,
	DbModelSelector,
	DEFAULT_ARCHIVE_LIMITS,
	GatewayDriver,
	InMemoryImageStore,
	createLoopLogger,
	loadBuiltinPlaybook,
	type EntityProposalPayload,
	type JobDocument,
	type JobEvent,
	type LoadedPlaybook,
	type RelationProposalPayload,
	type StepSample
} from '@canonry/import';
import { createGateway, readGatewayCredentials, resolveModel } from '@canonry/ai';
import type { Db } from '@canonry/db';
import { loadEnv } from './env.js';

export interface ImportRunResult {
	entities: EntityProposalPayload[];
	relations: RelationProposalPayload[];
	events: JobEvent[];
	inputTokens: number;
	outputTokens: number;
	costEur: number;
	credits: number;
	steps: number;
	status: string;
	detail: string;
	/** Every step and tool call the loop logged, captured rather than printed. */
	loopLog: Array<Record<string, unknown>>;
	/** issue #271: every model call's transcript breakdown, when `profile` asked for it.
	 * Empty otherwise, because the driver does no profiling work without a profiler. */
	stepProfile: StepSample[];
}

/** The `LanguageModelFactory` `DbModelSelector` needs. Same bypass as `benchModelFactory`
 * in `src/models/factory.ts` and for the same reason: a candidate provider that
 * `KNOWN_PROVIDERS` has not blessed yet still has to be measurable. */
function gatewayLanguageModelFactory() {
	loadEnv();
	const gateway = createGateway(readGatewayCredentials(process.env));
	return (provider: string, modelId: string) => gateway.languageModel(`${provider}/${modelId}`);
}

export interface RunImportDocumentsInput {
	db: Db;
	/** Path to the built zip, e.g. `.data/corpus/obsidian/v1.zip`. */
	archive: string;
	playbookId: string;
	documents: JobDocument[];
	jobId: string;
	maxCredits?: number;
	/** issue #271: record what each step's input was built from. Off by default: the
	 * driver's profiling path only runs when someone is listening. */
	profile?: boolean;
}

export async function runImportDocuments(input: RunImportDocumentsInput): Promise<ImportRunResult> {
	const playbook: LoadedPlaybook = await loadBuiltinPlaybook(input.playbookId);
	const reader = ArchiveSourceReader.open(readFileSync(input.archive), DEFAULT_ARCHIVE_LIMITS);
	const images = new InMemoryImageStore();
	const createLanguageModel = gatewayLanguageModelFactory();

	const loopLog: Array<Record<string, unknown>> = [];
	const stepProfile: StepSample[] = [];
	const driver = new GatewayDriver({
		models: new DbModelSelector({
			resolvePurpose: async (purpose) => resolveModel(input.db, purpose),
			createLanguageModel
		}),
		// `createLanguageModel` above already addresses the gateway, so the wrapper is the
		// identity, exactly as `apps/web/src/lib/server/copilot.ts` wires it.
		gateway: (model) => model,
		// The default logger writes a JSON line per step and per tool call to stdout, which
		// is right in a server and unreadable in a sweep of twelve candidates. Captured
		// instead, and handed back so a case that went wrong can be read afterwards.
		logger: createLoopLogger((fields) => loopLog.push({ ...fields })),
		...(input.profile === true ? { profiler: (sample) => stepProfile.push(sample) } : {})
	});

	const result: ImportRunResult = {
		entities: [],
		relations: [],
		events: [],
		inputTokens: 0,
		outputTokens: 0,
		costEur: 0,
		credits: 0,
		steps: 0,
		status: 'running',
		detail: '',
		loopLog,
		stepProfile
	};

	const stream = driver.startJob({
		id: input.jobId,
		playbook,
		documents: input.documents,
		budget: { maxCredits: input.maxCredits ?? 500 },
		sources: reader,
		images
	});

	for await (const event of stream) {
		result.events.push(event);
		result.steps = Math.max(result.steps, event.step);
		if (event.type === 'proposal') {
			if (event.proposal.kind === 'entity') result.entities.push(event.proposal.payload);
			else result.relations.push(event.proposal.payload);
		} else if (event.type === 'usage') {
			result.inputTokens += event.inputTokens;
			result.outputTokens += event.outputTokens;
			result.costEur += event.costEur;
			result.credits += event.credits;
		} else if (event.type === 'progress') {
			result.status = event.status;
			result.detail = event.detail;
		}
	}

	return result;
}
