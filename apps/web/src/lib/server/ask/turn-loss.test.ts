/**
 * Issue #699: the three properties `turn-loss.ts` has to hold, each of which is a way to
 * get a *false* record rather than a missing one. A missing entry is a designed outcome
 * (both columns null, "we do not know"); a turn spent by the wrong account, or twice, would
 * be a caveat attached to an answer it is not about.
 */
import { describe, expect, it } from 'vitest';
import { _clearTurnLosses, recordTurnLoss, takeTurnLoss } from './turn-loss';

describe('turn loss ledger (issue #699)', () => {
	it('records a turn that finished as a claim rather than as an absence', () => {
		_clearTurnLosses();
		// `runAsk` reports `null` for a finished turn. Storing that as nothing would make
		// "it finished" indistinguishable from "we never knew", which is the distinction the
		// two nullable columns exist for.
		const id = recordTurnLoss('user-1', null);
		expect(takeTurnLoss('user-1', id)).toEqual({ truncated: false, lostProposals: 0 });
	});

	it('hands a truncated turn back exactly as runAsk reported it', () => {
		_clearTurnLosses();
		const id = recordTurnLoss('user-1', { truncated: true, lostProposals: 2 });
		expect(takeTurnLoss('user-1', id)).toEqual({ truncated: true, lostProposals: 2 });
	});

	it('spends an id once, so one truncated turn cannot mark a second kept answer', () => {
		_clearTurnLosses();
		const id = recordTurnLoss('user-1', { truncated: true, lostProposals: 1 });
		expect(takeTurnLoss('user-1', id)).toEqual({ truncated: true, lostProposals: 1 });
		expect(takeTurnLoss('user-1', id)).toBeNull();
	});

	it('refuses an id belonging to another account, and spends it anyway', () => {
		_clearTurnLosses();
		const id = recordTurnLoss('user-1', { truncated: true, lostProposals: 1 });
		expect(takeTurnLoss('user-2', id)).toBeNull();
		// Spent rather than left lying around: an id offered by the wrong account does not get
		// a second chance from the right one either, because by then it is a handle somebody
		// else has seen.
		expect(takeTurnLoss('user-1', id)).toBeNull();
	});

	it('answers null for an id it never issued and for no id at all', () => {
		_clearTurnLosses();
		expect(takeTurnLoss('user-1', '00000000-0000-4000-8000-000000000001')).toBeNull();
		expect(takeTurnLoss('user-1', undefined)).toBeNull();
	});

	it('mints a distinct id per turn, so two answers in one conversation cannot collide', () => {
		_clearTurnLosses();
		const first = recordTurnLoss('user-1', { truncated: true, lostProposals: 1 });
		const second = recordTurnLoss('user-1', null);
		expect(first).not.toBe(second);
		expect(takeTurnLoss('user-1', second)).toEqual({ truncated: false, lostProposals: 0 });
		expect(takeTurnLoss('user-1', first)).toEqual({ truncated: true, lostProposals: 1 });
	});
});
