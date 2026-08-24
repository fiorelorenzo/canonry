/**
 * Issue #638: `orderVocabularyQuestions`, the review queue's ordering of an import's
 * vocabulary questions.
 *
 * Measured on the OneNote notebook, replayed from #613's recording so the model's output is
 * byte-identical between runs: 133 questions, 194 relations waiting, 103 of the questions
 * unblocking exactly one. Read by `created_at`, a GM answers 62 of them before half those
 * relations are unblocked; ordered by what each one unblocks, 36. The first question they
 * see goes from 7 relations to 11.
 *
 * What this file pins is the two halves of that claim which a reader would otherwise have
 * to trust: the order is by count, and nothing else about the queue moves. The second half
 * is the guardrail (1 and 3): ordering is presentation, so the same questions are asked, in
 * the same number, with the same evidence, and no entity proposal is displaced to make a
 * vocabulary question look better placed.
 *
 * Fails on 9a8a4f8, where the function does not exist and the read is `created_at` alone.
 */
import { describe, expect, it } from 'vitest';
import { orderVocabularyQuestions } from './proposals.js';
import type { ProposalRow } from './proposals.js';

let clock = 0;

/** Only the four fields the ordering reads. The rest of `ProposalRow` is irrelevant here
 * and inventing plausible values for it would only make a reader wonder which ones matter. */
function row(kind: string, rank: number, id: string): ProposalRow {
	clock += 1000;
	return { id, kind, rank, createdAt: new Date(clock) } as unknown as ProposalRow;
}

const ids = (rows: ProposalRow[]) => rows.map((r) => r.id);

describe('orderVocabularyQuestions (issue #638)', () => {
	it('puts the question that unblocks the most first', () => {
		const rows = [
			row('relation_type_new', 1, 'one'),
			row('relation_type_new', 11, 'eleven'),
			row('relation_type_new', 2, 'two')
		];
		expect(ids(orderVocabularyQuestions(rows))).toEqual(['eleven', 'two', 'one']);
	});

	it('leaves every other candidate exactly where the queue had it', () => {
		// The shape a real import has: entity proposals with vocabulary questions among them.
		// Only the questions move, and only into each other's places, so a GM who learned the
		// queue by scrolling it does not find the entries rearranged underneath them.
		const rows = [
			row('create', 0, 'entry-a'),
			row('relation_type_new', 1, 'q-one'),
			row('create', 1, 'entry-b'),
			row('relation_type_new', 6, 'q-six'),
			row('relation', 0, 'link'),
			row('relation_type_widen', 3, 'q-three')
		];
		expect(ids(orderVocabularyQuestions(rows))).toEqual([
			'entry-a',
			'q-six',
			'entry-b',
			'q-three',
			'link',
			'q-one'
		]);
	});

	it('keeps the emission order between questions of equal weight', () => {
		// 103 of the notebook's 133 questions weigh exactly one, so the tiebreak decides most
		// of the queue's tail. Emission order is what the run produced and the only thing
		// there that is not arbitrary.
		const rows = [row('relation_type_new', 1, 'first'), row('relation_type_new', 1, 'second')];
		expect(ids(orderVocabularyQuestions(rows))).toEqual(['first', 'second']);
	});

	it('asks the same questions, and every one of them', () => {
		// Guardrail 1 and 3 read strictly: this is presentation. Nothing may be dropped,
		// merged, deduplicated or hidden behind a "more" - a hundred one-relation questions
		// stay a hundred questions the GM will be asked.
		const rows = [
			row('relation_type_new', 1, 'a'),
			row('relation_type_reuse', 4, 'b'),
			row('create', 0, 'c'),
			row('relation_type_widen', 1, 'd'),
			row('relation_type_new', 2, 'e')
		];
		const ordered = orderVocabularyQuestions(rows);
		expect(ordered).toHaveLength(rows.length);
		expect([...ids(ordered)].sort()).toEqual([...ids(rows)].sort());
		expect(ordered.filter((r) => r.kind.startsWith('relation_type')).map((r) => r.rank)).toEqual([
			4, 2, 1, 1
		]);
	});

	it('returns the queue untouched when there is nothing to order', () => {
		const rows = [row('create', 0, 'a'), row('relation_type_new', 1, 'only')];
		expect(orderVocabularyQuestions(rows)).toBe(rows);
		expect(orderVocabularyQuestions([])).toEqual([]);
	});

	it("front-loads the notebook's own distribution: 36 questions to half its 194 relations", () => {
		// The real distribution, from the replayed run: one question at 11, one at 7, two at 6,
		// three at 4, three at 3, twenty at 2, a hundred and three at 1. What the assertion is
		// about is the ordered side, which is deterministic; the 62 the same run needs when it
		// is read by `created_at` depends on the emission order and is measured in the harness
		// rather than restated here, since a stub of that order would only be my guess at it.
		const sizes = [11, 7, 6, 6, 4, 4, 4, 3, 3, 3, ...Array(20).fill(2), ...Array(103).fill(1)];
		const rows = sizes.map((size, i) => row('relation_type_new', size, `q${i}`));
		const total = sizes.reduce((sum, n) => sum + n, 0);
		expect(total).toBe(194);

		let answered = 0;
		let unblocked = 0;
		for (const question of orderVocabularyQuestions(rows)) {
			if (unblocked >= total / 2) break;
			answered += 1;
			unblocked += question.rank;
		}
		expect(answered).toBe(36);
	});
});
