/**
 * Task `ask`, purpose `premium`: the answer a GM reads mid-session.
 *
 * `runAsk` retrieves first and generates second, and only the second half is the model's.
 * Retrieval is identical for every candidate here (the same seeded canon, the same Qdrant
 * collection, the same embedder), so the difference between two rows in this table is
 * entirely what the model did with the same sources. That is the comparison worth having,
 * and it is also why the retrieval quality question is measured separately in
 * `src/e2e/loremaster.ts` rather than confused with the model choice.
 *
 * The three unanswerable questions in the corpus carry the most weight of anything in this
 * bench. Guardrail 1 and guardrail 7 both come down to the copilot being willing to say
 * that the canon does not answer something, and a model that fills the gap with plausible
 * fiction is disqualifying rather than merely worse. They are scored as a pass or fail on
 * whether the answer admits the gap, and a model that invents on them cannot reach the top
 * of the table however well it writes.
 */
import { runAsk } from '@canonry/copilot';
import { createVectorClient } from '@canonry/vector';
import { detectLanguage } from '@canonry/lang';
import { resolveModel } from '@canonry/ai';
import { ASK_QUESTIONS } from '../../corpus/gold.js';
import { benchFixture } from '../../fixture.js';
import { benchEmbedder } from '../../embedder.js';
import { benchModelFactory, identityGateway } from '../factory.js';
import { judgeAdmission, judgeOutput, type JudgedCase } from '../judge.js';
import type { BenchTask, CaseOutcome, TaskContext } from '../runner.js';
import { usageSince } from '../runner.js';

export const askTask: BenchTask = {
	id: 'ask',
	purpose: 'premium',
	measures:
		'answers from retrieved canon only, judged, with a hard zero for a claim the sources do not carry and for inventing an answer to an unanswerable question',
	caseIds: () => ASK_QUESTIONS.map((q) => q.id),

	async runCase(ctx: TaskContext, caseId: string): Promise<CaseOutcome> {
		const question = ASK_QUESTIONS.find((q) => q.id === caseId);
		if (!question) throw new Error(`no ask question ${caseId}`);

		const fixture = await benchFixture(ctx.db);
		const resolved = await resolveModel(ctx.db, 'premium');
		const started = Date.now();
		const since = new Date(started - 1000);

		const result = await runAsk({
			db: ctx.db,
			userId: fixture.userId,
			universeId: fixture.universeId,
			question: question.question,
			locale: question.language,
			detailLevel: 'normal',
			vectorClient: createVectorClient(),
			embedder: await benchEmbedder(ctx.db),
			modelFactory: benchModelFactory,
			gateway: identityGateway
		});
		const latencyMs = Date.now() - started;
		const usage = await usageSince(ctx.db, since, resolved.provider, resolved.modelId);

		const answer = result.answer;
		const lowered = answer.toLowerCase();
		const mentioned = question.mustMention.filter((m) => lowered.includes(m.toLowerCase()));
		const wronglyClaimed = question.mustNotClaim.filter((m) => lowered.includes(m.toLowerCase()));
		const answerLanguage = detectLanguage(answer);
		const languageOk = answerLanguage === null || answerLanguage === question.language;

		let score: number;
		let judged: JudgedCase | null = null;
		let admissionPerJudge: unknown = null;

		let admits: boolean | null = null;
		if (question.mustMention.length === 0) {
			// The unanswerable cases. There is nothing to judge for craft here: either the
			// model said the canon does not settle this, or it made something up.
			const verdict = await judgeAdmission(question.question, answer);
			admits = verdict.admits;
			admissionPerJudge = verdict.perJudge;
			score = admits && wronglyClaimed.length === 0 ? 1 : 0;
		} else {
			judged = await judgeOutput({
				instruction:
					`Answer this question about the game world using only the sources listed: ` +
					`"${question.question}". Do not invent anything the sources do not support. ` +
					`Answer in ${question.language}.`,
				context: result.sources.map((s) => `- ${JSON.stringify(s).slice(0, 1200)}`).join('\n'),
				output: answer,
				extra:
					'The sources may be in a different language from the question. Answering in the ' +
					`question's language (${question.language}) while drawing on sources in the other ` +
					'is correct and must not be marked down.'
			});
			const factualHit = mentioned.length / question.mustMention.length;
			score = judged.score * (0.4 + 0.6 * factualHit);
			if (wronglyClaimed.length > 0) score = 0;
		}
		if (!languageOk) score *= 0.5;

		return {
			caseId,
			ok: answer.trim().length > 0,
			score,
			detail: {
				question: question.question,
				answer,
				sourceCount: result.sources.length,
				generated: result.generated,
				mustMention: question.mustMention,
				mentioned,
				wronglyClaimed,
				admits,
				admissionPerJudge,
				unanswerable: question.mustMention.length === 0,
				askedLanguage: question.language,
				answerLanguage,
				languageOk,
				note: question.note,
				judgeScore: judged?.score ?? null,
				judgeDisagreement: judged?.disagreement ?? null,
				bothFoundInvention: judged?.bothFoundInvention ?? null,
				eitherFoundInvention: judged?.eitherFoundInvention ?? null,
				verdicts: judged?.verdicts ?? null
			},
			latencyMs,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			costEur: usage.costEur
		};
	}
};
