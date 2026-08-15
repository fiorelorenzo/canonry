/**
 * Scoring the tasks that have no gold answer.
 *
 * Ranking, audit and extraction are scored against ground truth, so no model opinion
 * enters. The three prose tasks (a propagation diff, a completed entry, an Ask answer)
 * have no single right output, and pretending otherwise by string-matching a reference
 * answer would measure similarity to whatever I happened to write. So they are judged, and
 * the judging is built to be checkable rather than trusted:
 *
 * - **Two judges from different houses.** A judge that scores its own family higher is the
 *   documented failure of this technique, and one judge gives no way to see it. Both scores
 *   are reported, and so is their disagreement.
 * - **The judge never sees which model wrote the answer**, and the two judges see the same
 *   prompt.
 * - **Criteria that a human could re-check.** "Grounded" means every claim traces to the
 *   supplied context, and the judge has to name the claims it thought were invented. A
 *   score with no named span behind it is the thing that makes judged benchmarks
 *   unfalsifiable, so the bench writes those spans out with the run.
 * - **Guardrail 1 is a hard gate, not a criterion.** A proposal that invents canon is not a
 *   four out of five on grounding, it is a failure, so `inventedClaims` being non-empty
 *   zeroes the case regardless of the other numbers.
 */
import { generateObject } from 'ai';
import { z } from 'zod';
import { benchModelFactory } from './factory.js';
import { JUDGES, type Judge } from './candidates.js';
import { withRetry } from './runner.js';

const verdictSchema = z.object({
	grounded: z
		.number()
		.int()
		.min(0)
		.max(4)
		.describe('every claim traceable to the supplied context, nothing invented'),
	useful: z.number().int().min(0).max(4).describe('does the job the instruction asked for'),
	craft: z
		.number()
		.int()
		.min(0)
		.max(4)
		.describe("reads like the world's own prose and changes no more than it must"),
	inventedClaims: z
		.array(z.string())
		.describe(
			'each claim in the output that the context does not support, quoted. Empty when there are none.'
		),
	comment: z.string().describe('one sentence, the reason a reader would want')
});

export type Verdict = z.infer<typeof verdictSchema>;

export interface JudgedCase {
	/** 0 to 1. Zero when both judges independently named an invented claim. */
	score: number;
	/** Both judges could not trace something the output asserted. This is the guardrail-1
	 * failure, and it is what zeroes a case. */
	bothFoundInvention: boolean;
	/** Only one of them did. Not a zero, but worth reading: a model that keeps tripping one
	 * judge is doing something a careful reader dislikes. */
	eitherFoundInvention: boolean;
	verdicts: Record<Judge, Verdict>;
	/** Absolute gap between the two judges' normalised scores. Above 0.25 the case is
	 * reported as unresolved rather than quietly averaged. */
	disagreement: number;
	unresolved: boolean;
	inputTokens: number;
	outputTokens: number;
}

export interface JudgeRequest {
	/** What the model under test was asked to do, in the judge's words rather than the
	 * original system prompt: the judge is scoring the output, not re-running the task. */
	instruction: string;
	/** Everything the model was allowed to use. The judge decides "grounded" against this
	 * and nothing else, so it must be complete. */
	context: string;
	/** What came back. */
	output: string;
	/** Task-specific things to look for, appended to the rubric. */
	extra?: string;
}

const RUBRIC = `You are scoring one output from a tabletop-RPG world wiki's AI copilot.

The product's first rule is that the copilot proposes and never writes canon on its own, and
that every proposal is traceable to evidence the user can check. An output that invents a
fact, a person, a place or a date that the context does not support is not a good output with
a flaw. It is the failure the whole product is built to prevent.

Score three things, 0 to 4 each:

- grounded: 4 when every factual claim traces to the context. 0 when the output is largely
  invented. Quote in inventedClaims every claim you could not trace. A claim the context
  contradicts counts as invented.
- useful: 4 when the output does exactly what the instruction asked and a GM could act on it
  as it stands. 0 when it dodges, hedges into uselessness, or answers a different question.
  Admitting that the context does not answer the question is USEFUL when that is true, and is
  the correct answer, not a dodge.
- craft: 4 when it reads like the surrounding prose, keeps the source's language, and changes
  no more than the instruction requires. 0 when it rewrites what it was not asked to touch,
  switches language, or reads like a chatbot rather than a wiki.

Be hard. A 4 means you would ship it without editing.`;

export async function judgeOutput(request: JudgeRequest): Promise<JudgedCase> {
	const prompt = [
		RUBRIC,
		request.extra ? `\nAlso weigh this, specific to the task:\n${request.extra}` : '',
		'\n--- INSTRUCTION GIVEN TO THE MODEL ---\n',
		request.instruction,
		'\n--- CONTEXT THE MODEL WAS ALLOWED TO USE ---\n',
		request.context,
		'\n--- THE OUTPUT YOU ARE SCORING ---\n',
		request.output
	].join('\n');

	const verdicts = {} as Record<Judge, Verdict>;
	let inputTokens = 0;
	let outputTokens = 0;

	for (const judge of JUDGES) {
		const cut = judge.indexOf('/');
		const result = await withRetry(() =>
			generateObject({
				model: benchModelFactory({
					purpose: 'premium',
					provider: judge.slice(0, cut),
					modelId: judge.slice(cut + 1),
					params: {}
				}),
				schema: verdictSchema,
				prompt
			})
		);
		verdicts[judge] = result.object;
		inputTokens += result.usage.inputTokens ?? 0;
		outputTokens += result.usage.outputTokens ?? 0;
	}

	const normalised = JUDGES.map((judge) => {
		const v = verdicts[judge];
		return (v.grounded + v.useful + v.craft) / 12;
	});
	// The hard zero needs BOTH judges, and that is a correction rather than a softening.
	// The first run of this bench zeroed a case whenever either judge named an invented
	// claim, and the result measured the stricter judge: gpt-5.4 called an inferential
	// clause like "confiding in her ability to move through the district" an invention on an
	// answer that opus scored 4 out of 4 for grounding with no inventions at all. A claim
	// two judges from different houses independently cannot trace is evidence. A claim one
	// of them dislikes is a disagreement, and disagreements belong in `disagreement`, not in
	// a zero that silently reranks the whole table.
	const bothFoundInvention = JUDGES.every((judge) => verdicts[judge].inventedClaims.length > 0);
	const eitherFoundInvention = JUDGES.some((judge) => verdicts[judge].inventedClaims.length > 0);
	const mean = normalised.reduce((a, b) => a + b, 0) / normalised.length;
	const disagreement = Math.abs((normalised[0] ?? 0) - (normalised[1] ?? 0));

	return {
		score: bothFoundInvention ? 0 : mean,
		bothFoundInvention,
		eitherFoundInvention,
		verdicts,
		disagreement,
		unresolved: disagreement > 0.25,
		inputTokens,
		outputTokens
	};
}

const admissionSchema = z.object({
	admits: z.boolean().describe('the answer states that the sources do not settle the question'),
	asserts: z.boolean().describe('the answer nonetheless asserts an answer to the question as fact'),
	quote: z.string().describe('the clause that made you decide, quoted from the answer')
});

export interface AdmissionVerdict {
	/** Both judges saw the answer admit the gap and neither saw it assert an answer. */
	admits: boolean;
	perJudge: Record<Judge, z.infer<typeof admissionSchema>>;
	inputTokens: number;
	outputTokens: number;
}

/**
 * For the questions the canon does not answer, which is the only place in this bench where
 * one behaviour is right and everything else is disqualifying.
 *
 * This started as a list of regular expressions and that was wrong in a way worth
 * recording: a model that answered "the sources do not explicitly identify who killed the
 * man" was scored as having invented an answer, because the pattern list happened to carry
 * "say", "mention" and "record" but not "identify". Phrase-matching a refusal is
 * phrase-matching, and the right answer here is written in prose, in two languages, so it
 * gets judged like the prose it is.
 */
export async function judgeAdmission(question: string, answer: string): Promise<AdmissionVerdict> {
	const prompt =
		'A question was asked about a game world whose canon does not answer it. The only ' +
		'correct behaviour is to say plainly that the sources do not settle it. Saying so and ' +
		'then laying out what the sources DO carry around the question is still correct. ' +
		'Asserting an answer, or implying one, is not.\n\n' +
		`Question: ${question}\n\nAnswer:\n${answer}`;

	const perJudge = {} as Record<Judge, z.infer<typeof admissionSchema>>;
	let inputTokens = 0;
	let outputTokens = 0;
	for (const judge of JUDGES) {
		const cut = judge.indexOf('/');
		const result = await withRetry(() =>
			generateObject({
				model: benchModelFactory({
					purpose: 'premium',
					provider: judge.slice(0, cut),
					modelId: judge.slice(cut + 1),
					params: {}
				}),
				schema: admissionSchema,
				prompt
			})
		);
		perJudge[judge] = result.object;
		inputTokens += result.usage.inputTokens ?? 0;
		outputTokens += result.usage.outputTokens ?? 0;
	}

	return {
		admits: JUDGES.every((j) => perJudge[j].admits && !perJudge[j].asserts),
		perJudge,
		inputTokens,
		outputTokens
	};
}
