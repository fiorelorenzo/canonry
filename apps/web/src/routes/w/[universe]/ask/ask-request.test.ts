/**
 * issue #380, decision R5: `parseAskRequestBody`'s own contract - the wire shape
 * `history`/`context` add to `POST /w/<universe>/ask`. Exercised directly, without a live
 * database or a real request, because the function itself takes neither (see its own
 * comment in `+server.ts`): the point of this file is the validate-then-clamp behaviour,
 * not that the route can reach a database, which `review.test.ts` and friends already
 * cover for this directory's sibling endpoints.
 */
import { describe, expect, it } from 'vitest';
import { MAX_HISTORY_TURNS, MAX_HISTORY_TURN_CHARS } from '@canonry/copilot';
import { parseAskRequestBody } from './+server.js';

describe('parseAskRequestBody (issue #380, decision R5)', () => {
	it('rejects a missing or blank question, the one field this route still 400s on', () => {
		expect(parseAskRequestBody({})).toBeNull();
		expect(parseAskRequestBody({ question: '   ' })).toBeNull();
		expect(parseAskRequestBody({ question: 42 })).toBeNull();
	});

	it('defaults detailLevel, history and context when the body carries none of them', () => {
		const parsed = parseAskRequestBody({ question: '  Why was Aldric Vane dismissed?  ' });
		expect(parsed).toEqual({
			question: 'Why was Aldric Vane dismissed?',
			detailLevel: 'normal',
			history: [],
			context: null
		});
	});

	it('keeps a well-formed history in order, oldest first, under the cap', () => {
		const parsed = parseAskRequestBody({
			question: 'Who commands the watch now?',
			history: [
				{ role: 'gm', text: 'What happened to the old commander?' },
				{ role: 'loremaster', text: 'He was dismissed after the Sable Winter.' }
			]
		});
		expect(parsed?.history).toEqual([
			{ role: 'gm', text: 'What happened to the old commander?' },
			{ role: 'loremaster', text: 'He was dismissed after the Sable Winter.' }
		]);
	});

	it('clamps more turns than the cap, dropping the oldest first rather than rejecting the request', () => {
		const totalTurns = MAX_HISTORY_TURNS + 3;
		const history = Array.from({ length: totalTurns }, (_, i) => ({
			role: i % 2 === 0 ? 'gm' : 'loremaster',
			text: `turn ${i}`
		}));

		const parsed = parseAskRequestBody({ question: 'Who commands the watch now?', history });
		expect(parsed).not.toBeNull();
		expect(parsed?.history).toHaveLength(MAX_HISTORY_TURNS);
		expect(parsed?.history.map((turn) => turn.text)).toEqual(
			Array.from(
				{ length: MAX_HISTORY_TURNS },
				(_, i) => `turn ${totalTurns - MAX_HISTORY_TURNS + i}`
			)
		);
	});

	it('truncates an over-long turn at the cap rather than rejecting the request', () => {
		const longText = 'a'.repeat(MAX_HISTORY_TURN_CHARS + 500);
		const parsed = parseAskRequestBody({
			question: 'Who commands the watch now?',
			history: [{ role: 'gm', text: longText }]
		});
		expect(parsed?.history).toEqual([{ role: 'gm', text: 'a'.repeat(MAX_HISTORY_TURN_CHARS) }]);
	});

	it('falls back to an empty history on a malformed shape, without rejecting the question', () => {
		const parsed = parseAskRequestBody({
			question: 'Who commands the watch now?',
			history: [{ role: 'narrator', text: 'not a real role' }]
		});
		expect(parsed?.question).toBe('Who commands the watch now?');
		expect(parsed?.history).toEqual([]);
	});

	it('carries a well-formed entry context through, and a world context with no entityType', () => {
		const entry = parseAskRequestBody({
			question: 'Why was he dismissed?',
			context: { kind: 'entry', name: 'Aldric Vane', entityType: 'character' }
		});
		expect(entry?.context).toEqual({ kind: 'entry', name: 'Aldric Vane', entityType: 'character' });

		const world = parseAskRequestBody({
			question: 'What is going on?',
			context: { kind: 'world', name: 'Valdoria Reach' }
		});
		expect(world?.context).toEqual({ kind: 'world', name: 'Valdoria Reach' });

		const explicitNull = parseAskRequestBody({ question: 'What is going on?', context: null });
		expect(explicitNull?.context).toBeNull();
	});

	it('falls back to a null context on a malformed shape, without rejecting the question', () => {
		const parsed = parseAskRequestBody({
			question: 'Why was he dismissed?',
			context: { kind: 'faction', name: 'The Ashen Ledger' }
		});
		expect(parsed?.question).toBe('Why was he dismissed?');
		expect(parsed?.context).toBeNull();
	});
});
