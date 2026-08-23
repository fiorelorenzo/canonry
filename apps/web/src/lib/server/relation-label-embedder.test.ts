/**
 * Issue #629: which embedder a real import hands `resolveRelationType`'s semantic rung.
 *
 * The claim these tests exist to pin is a claim about the composition root, so they assert
 * on what `startImportRun` actually puts in `RunImportJobParams` rather than on the resolver
 * that builds it. Until #629 that field was `hashingEmbedder` unconditionally, on a comment
 * whose premise (this box has no credentials, so the deterministic stand-in is honest) is
 * false on any box that does have them, because `resolveImportDriver` in the same file
 * returns the real `GatewayDriver` there.
 *
 * The sharp assertion is the one that needs no credential: the pair measured on #613's
 * recorded notebook, where `hashingEmbedder` scores "fondata da" against `appointed`'s
 * Italian label at a perfect 1.0 and the rung proposes a merge of two unrelated relations.
 * An embedder that cannot tell two labels apart must not be the thing deciding whether they
 * are the same relation, and this file fails on `f94c9d7` for exactly that reason.
 *
 * Runs against `TEST_DATABASE_URL` (this repo's `TEST_DB_SUFFIX` convention), and reaches no
 * gateway: `ImportJobRunner.run` is spied out, so nothing the resolved embedder is handed to
 * ever calls it.
 */
import { closeDb, createDb, type Db } from '@canonry/db';
import { clearModelCache } from '@canonry/ai';
import type * as Indexing from '@canonry/indexing';
import type { GatewayEmbedderDeps } from '@canonry/indexing';
import { hashingEmbedder } from '@canonry/indexing';
import {
	ImportJobRunner,
	loadBuiltinPlaybook,
	type RunImportJobParams,
	type RunImportJobResult
} from '@canonry/import';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveRelationLabelEmbedder, startImportRun } from './onboarding.js';

/** Same idiom as `import-similarity.test.ts`: `vi.mock` is hoisted above every import here,
 * so its factory runs while `./onboarding.js` is loading and a plain top-level `const` would
 * still be undefined. The two branches differ only in whether `AI_GATEWAY_API_KEY` is set. */
const { gatewayEnv, embedderDeps } = vi.hoisted(() => ({
	gatewayEnv: {} as Record<string, string | undefined>,
	embedderDeps: [] as Array<{ operation?: string }>
}));

vi.mock('$env/dynamic/private', () => ({ env: gatewayEnv }));

vi.mock('@canonry/indexing', async (importActual) => {
	const actual = await importActual<typeof Indexing>();
	return {
		...actual,
		createGatewayEmbedder: (deps: GatewayEmbedderDeps) => {
			embedderDeps.push({ operation: deps.operation });
			return actual.createGatewayEmbedder(deps);
		}
	};
});

const DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	process.env.DATABASE_URL ??
	'postgres://canonry:canonry@127.0.0.1:55432/canonry';

let db: Db;

beforeAll(() => {
	db = createDb(DATABASE_URL);
});

afterAll(async () => {
	await closeDb(db);
});

beforeEach(() => {
	for (const key of Object.keys(gatewayEnv)) delete gatewayEnv[key];
	embedderDeps.length = 0;
	clearModelCache();
	vi.restoreAllMocks();
});

const CONTEXT = { userId: 'irrelevant-no-call-is-made', universeId: null };

/** The measured false merge, verbatim: the notebook's "fondata da" ("founded by") against the
 * `appointed` catalogue row's own Italian label. Two different relations, and one 256-bucket
 * hash apart. */
const FOUNDED_BY = 'fondata da';
const APPOINTED_BY_IT = 'nominato da';

function cosine(a: number[], b: number[]): number {
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i]! * b[i]!;
		na += a[i]! * a[i]!;
		nb += b[i]! * b[i]!;
	}
	if (na === 0 || nb === 0) return 0;
	return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function scorePair(embed: (texts: string[]) => Promise<number[][]>): Promise<number> {
	const [left, right] = await embed([FOUNDED_BY, APPOINTED_BY_IT]);
	return cosine(left!, right!);
}

/** A single-file upload, which `openArtefact` opens as its own one entry (issue #591), plus
 * the `.name` sibling `storeUpload` writes beside the bytes. Enough for `startImportRun` to
 * get as far as building its params, which is all these tests read. */
async function artefact(): Promise<string> {
	const dir = await mkdtemp(path.join(tmpdir(), 'w629-'));
	const bytes = path.join(dir, 'artefact.upload');
	await writeFile(bytes, '# Session one\n\nThe party bribed the tide warden.\n');
	await writeFile(path.join(dir, 'artefact.name'), 'session-one.md');
	return bytes;
}

/** Runs the real `startImportRun` and returns the params it handed the runner. `run` is
 * replaced rather than wrapped, so no job executes and no model is reached. */
async function paramsFromProductionPath(): Promise<RunImportJobParams> {
	let resolve: (params: RunImportJobParams) => void;
	const captured = new Promise<RunImportJobParams>((r) => {
		resolve = r;
	});
	vi.spyOn(ImportJobRunner.prototype, 'run').mockImplementation(async (params) => {
		resolve(params);
		const result: RunImportJobResult = {
			jobId: params.dbJobId,
			finalStatus: 'finished',
			documents: [],
			proposalsEmitted: 0
		};
		return result;
	});
	startImportRun(db, {
		dbJobId: randomUUID(),
		universeId: randomUUID(),
		sourceSystem: 'generic',
		userId: 'irrelevant-no-job-runs',
		playbook: await loadBuiltinPlaybook('generic'),
		documents: [],
		artefactPath: await artefact(),
		budgetCredits: 1,
		timeoutMs: 1000
	});
	return captured;
}

describe('resolveRelationLabelEmbedder (issue #629)', () => {
	it('cannot score two unrelated labels as one relation with no AI_GATEWAY_API_KEY', async () => {
		const embed = await resolveRelationLabelEmbedder(db, CONTEXT);

		// `hashingEmbedder`, the old unconditional answer, scores this pair at 1.0 - a perfect
		// match between "founded by" and "appointed by" from a bucket collision, which crosses
		// `SEMANTIC_REUSE_THRESHOLD` and reaches a GM as a reuse proposal.
		expect(await scorePair(hashingEmbedder)).toBeCloseTo(1, 5);
		// Rung 2 has to be off rather than arbitrary when there is nothing to run it on.
		expect(await scorePair(embed)).toBe(0);
	});

	it('is the real gateway embedder once a key is present, billed to import matching', async () => {
		gatewayEnv.AI_GATEWAY_API_KEY = 'test-key-not-a-real-credential';

		const embed = await resolveRelationLabelEmbedder(db, CONTEXT);

		expect(embed).not.toBe(hashingEmbedder);
		// Issue #309's row, shared with entity matching on purpose: both are the semantic step
		// of an import, both are reading operations priced at zero.
		expect(embedderDeps).toEqual([{ operation: 'import.match.embed' }]);
	});
});

describe('the production import path (issue #629)', () => {
	it('hands the runner an embedder that cannot invent a reuse, with no credential', async () => {
		const params = await paramsFromProductionPath();

		expect(params.embedRelationLabel).not.toBe(hashingEmbedder);
		expect(await scorePair(params.embedRelationLabel)).toBe(0);
	});

	it('hands the runner the gateway embedder when the process has a credential', async () => {
		gatewayEnv.AI_GATEWAY_API_KEY = 'test-key-not-a-real-credential';

		const params = await paramsFromProductionPath();

		expect(params.embedRelationLabel).not.toBe(hashingEmbedder);
		// Two embedders resolved, not one: entity matching's and the relation rung's. Before
		// #629 only the first existed and the rung got the network-free stand-in.
		expect(embedderDeps).toEqual([
			{ operation: 'import.match.embed' },
			{ operation: 'import.match.embed' }
		]);
	});
});
