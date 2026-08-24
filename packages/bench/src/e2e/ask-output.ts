/**
 * What one Ask turn actually spends in output tokens, against the real `premium` row.
 *
 *   pnpm --filter @canonry/bench ask-output
 *
 * Issue #698. `packages/copilot`'s `runAsk` now passes a `maxOutputTokens` and the number
 * has to be defensible against a real answer rather than a round figure, so this is the
 * measurement behind it. It is also the thing to re-run when `model_config`'s `premium`
 * row moves, because the number this bounds is per-step output and a different model is a
 * different natural answer length. `docs/models.md` is where the conclusion goes.
 *
 * Three things about the shape of the measurement, because each of them decides how the
 * number generalises off this corpus:
 *
 * - **A turn's total output is an upper bound on any one step's.** `maxOutputTokens` is
 *   per step, and `model_call` records the whole turn (one `withQuota` call wraps the
 *   whole `streamText` loop). On a turn with no tool call the loop runs exactly one step -
 *   `streamText` only starts another when a client tool call came back answered - so the
 *   two are the same number, and that is the binding case: a pure-prose `full` answer is
 *   the longest single step Ask can produce. On a turn that proposes, the total is spread
 *   across steps, so reading it as one step's is conservative in the right direction.
 * - **The prompt's source budget bounds the answer, not the size of the world.** `runAsk`
 *   gives the model at most `OWN_CANON_LIMIT` own-canon sentences plus its indexed layer,
 *   so a mature 4000-entry world does not hand a turn more material to write about than
 *   this corpus does. That is what makes a number measured here worth anything anywhere.
 * - **`full` is the only detail level that matters here** ("at least four paragraphs:
 *   ... then go further with every other relevant detail, caveat and connection the
 *   sources support"). `detailed` is measured beside it as the control, so the report
 *   shows the gap the instruction actually buys rather than asserting one.
 *
 * The questions are deliberately not the gold set's. `ASK_QUESTIONS` is built to test
 * retrieval and cross-language behaviour, so most of its entries are narrow factual
 * questions whose honest `full` answer is three sentences long. Sizing a ceiling against
 * those would size it against the easy case. `BROAD_QUESTIONS` below asks the widest
 * questions this world can support, in both languages, including one that asks for a
 * proposal so the multi-step shape is on the record too.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ASK_MAX_OUTPUT_TOKENS, runAsk, type AskDetailLevel } from '@canonry/copilot';
import { resolveModel } from '@canonry/ai';
import { and, closeDb, createDb, eq, type Db } from '@canonry/db';
import { modelCall } from '@canonry/db/schema';
import { createVectorClient } from '@canonry/vector';
import type { Locale } from '@canonry/lang';
import { dataDir, loadEnv, requireEnv } from '../env.js';
import { benchEmbedder } from '../embedder.js';
import { benchFixture, topUpCredits } from '../fixture.js';
import { benchModelFactory, identityGateway } from '../models/factory.js';
import { assertCreditAvailable } from '../models/credits.js';

interface BroadQuestion {
	id: string;
	question: string;
	locale: Locale;
	/** Why this one is here, so a reader can tell a deliberately wide question from a
	 * narrow one that happens to be long. */
	note: string;
}

const BROAD_QUESTIONS: BroadQuestion[] = [
	{
		id: 'broad-01',
		question:
			'Tell me everything about the Valdoria Watch: who leads it, who serves in it, what it has been dealing with lately, and where it stands with the other factions in the city.',
		locale: 'en',
		note: 'Four sub-questions in one, each grounded in a different entry - the widest thing a GM plausibly types.'
	},
	{
		id: 'broad-02',
		question:
			'Give me a full briefing on the harbour district before tonight: the places, the people who work them, the factions that claim them, and every tension between them I should know about.',
		locale: 'en',
		note: 'The prep question. Spans places, characters, factions and events at once, so retrieval fills every own-canon slot.'
	},
	{
		id: 'broad-03',
		question:
			'What is the whole story of the Drowning at the Old Wharf, everyone connected to it, and every thread it left open?',
		locale: 'en',
		note: 'An event with named suspects and no resolution - the shape that pulls in the most caveats.'
	},
	{
		id: 'broad-04',
		question:
			'Raccontami tutto su La Casa dei Mercanti e su La Cricca del Molo: chi sono, cosa vogliono, cosa possiedono e come si scontrano.',
		locale: 'it',
		note: 'Same width in Italian, answered from English-language canon: SPEC.md §17 in the direction that costs the most output.'
	},
	{
		id: 'broad-05',
		question:
			'Walk me through every session so far and how each one changed the situation in Cairnmouth, then tell me what is still unresolved.',
		locale: 'en',
		note: 'Session recap plus synthesis - asks the model to restate a lot before it gets to the analysis.'
	},
	{
		id: 'broad-06',
		question:
			'Summarise the Ashen Ledger for me and then add an entry for their counting house in the Cistern Quarter, with everything the sources say about it.',
		locale: 'en',
		note: 'A long answer AND a proposal, so the multi-step turn is on the record rather than assumed.'
	}
];

/** Measured beside `full` on the same questions, as the control: the report should show
 * `full` costing meaningfully more, not the instruction making no difference. */
const LEVELS: AskDetailLevel[] = ['detailed', 'full'];

interface AskOutputObservation {
	id: string;
	detailLevel: AskDetailLevel;
	locale: Locale;
	question: string;
	/** From the `model_call` row this turn wrote, which is the provider's own count and not
	 * an estimate of ours. */
	outputTokens: number;
	inputTokens: number;
	credits: number;
	/** The visible answer, so a reader can see that the output tokens went into prose
	 * rather than into a provider's hidden reasoning. */
	answerChars: number;
	charsPerOutputToken: number;
	sources: number;
	proposals: number;
	/** `AskResult.loss`: null on a turn that finished. A non-null `truncated` here is the
	 * ceiling binding on a real answer, which is issue #698's third question answered in
	 * the wrong direction and a reason to raise the number rather than to accept it. */
	loss: { truncated: boolean; lostProposals: number } | null;
	seconds: number;
}

interface AskOutputReport {
	ranAt: string;
	premiumModel: string;
	/** The ceiling `runAsk` enforces per step, recorded so a later re-run says which one it
	 * measured under rather than leaving that to be inferred from the date. */
	capConstant: number;
	observations: AskOutputObservation[];
	summary: {
		byLevel: Record<
			string,
			{ runs: number; minOutputTokens: number; medianOutputTokens: number; maxOutputTokens: number }
		>;
		truncatedRuns: number;
	};
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** The provider's own output-token count for one turn, read back from the row `withQuota`
 * wrote for it. Keyed on the `requestId` this runner minted, which is the only handle a
 * caller of `runAsk` has on its own `model_call` row. */
async function outputTokensFor(
	db: Db,
	requestId: string
): Promise<{ inputTokens: number; outputTokens: number; credits: number }> {
	const [row] = await db
		.select({
			inputTokens: modelCall.inputTokens,
			outputTokens: modelCall.outputTokens,
			credits: modelCall.credits
		})
		.from(modelCall)
		.where(and(eq(modelCall.requestId, requestId), eq(modelCall.operation, 'ask.answer')))
		.limit(1);
	if (!row) throw new Error(`no ask.answer model_call row for requestId ${requestId}`);
	return row;
}

async function main(): Promise<void> {
	loadEnv();
	const url = requireEnv('DATABASE_URL');
	if (!/(_bench|_e2e)$/.test(new URL(url).pathname)) {
		throw new Error('point DATABASE_URL at a database whose name ends in _bench or _e2e');
	}
	requireEnv('QDRANT_URL');

	const balance = await assertCreditAvailable();
	console.log(`gateway balance ${balance.balanceUsd.toFixed(2)} USD`);

	const db = createDb(url, { max: 4, quiet: true });
	try {
		const fixture = await benchFixture(db);
		await topUpCredits(db);
		const premium = await resolveModel(db, 'premium');
		const embedder = await benchEmbedder(db, fixture.universeId);
		const client = createVectorClient();

		const observations: AskOutputObservation[] = [];
		for (const detailLevel of LEVELS) {
			for (const q of BROAD_QUESTIONS) {
				const requestId = randomUUID();
				const started = Date.now();
				let sources = 0;
				const result = await runAsk({
					db,
					userId: fixture.userId,
					universeId: fixture.universeId,
					question: q.question,
					locale: q.locale,
					detailLevel,
					vectorClient: client,
					embedder,
					modelFactory: benchModelFactory,
					gateway: identityGateway,
					requestId,
					onSources: (found) => {
						sources = found.length;
					}
				});
				const usage = await outputTokensFor(db, requestId);
				observations.push({
					id: q.id,
					detailLevel,
					locale: q.locale,
					question: q.question,
					outputTokens: usage.outputTokens,
					inputTokens: usage.inputTokens,
					credits: usage.credits,
					answerChars: result.answer.length,
					charsPerOutputToken:
						usage.outputTokens > 0
							? Number((result.answer.length / usage.outputTokens).toFixed(2))
							: 0,
					sources,
					proposals: result.proposals.length,
					loss: result.loss,
					seconds: (Date.now() - started) / 1000
				});
				const last = observations[observations.length - 1]!;
				console.log(
					`${detailLevel.padEnd(8)} ${q.id}  out=${String(last.outputTokens).padStart(6)}  ` +
						`chars=${String(last.answerChars).padStart(6)}  c/t=${last.charsPerOutputToken}  ` +
						`props=${last.proposals}  loss=${last.loss ? 'TRUNCATED' : 'none'}`
				);
			}
		}

		const byLevel: AskOutputReport['summary']['byLevel'] = {};
		for (const level of LEVELS) {
			const runs = observations.filter((o) => o.detailLevel === level).map((o) => o.outputTokens);
			byLevel[level] = {
				runs: runs.length,
				minOutputTokens: Math.min(...runs),
				medianOutputTokens: median(runs),
				maxOutputTokens: Math.max(...runs)
			};
		}
		const report: AskOutputReport = {
			ranAt: new Date().toISOString(),
			premiumModel: `${premium.provider}/${premium.modelId}`,
			capConstant: ASK_MAX_OUTPUT_TOKENS,
			observations,
			summary: {
				byLevel,
				truncatedRuns: observations.filter((o) => o.loss?.truncated === true).length
			}
		};

		mkdirSync(dataDir, { recursive: true });
		const out = path.join(dataDir, 'ask-output.json');
		writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

		console.log('');
		console.log(`premium: ${report.premiumModel}, per-step cap: ${report.capConstant}`);
		for (const level of LEVELS) {
			const s = byLevel[level]!;
			console.log(
				`${level.padEnd(8)} n=${s.runs}  min=${s.minOutputTokens}  median=${s.medianOutputTokens}  max=${s.maxOutputTokens}`
			);
		}
		console.log(`truncated runs: ${report.summary.truncatedRuns}/${observations.length}`);
		console.log(`report: ${out}`);
	} finally {
		await closeDb(db);
	}
}

await main();
