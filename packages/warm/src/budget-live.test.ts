import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getBalance } from '@canonry/db';
import { openTestDb } from './test-db.js';
import { createDbWarmBudgetPort } from './budget-live.js';
import { createTestUniverse, createTestUser } from './test-helpers.js';

const db = openTestDb();

afterAll(async () => {
	await closeDb(db);
});

describe('createDbWarmBudgetPort', () => {
	it('resolves the balance through the universe owner and spends against warm_budget_spent, not interactive credits', async () => {
		const userId = await createTestUser(db);
		const universeId = await createTestUniverse(db, userId);
		const port = createDbWarmBudgetPort(db);

		const before = await getBalance(db, userId);
		expect(before.warmBudgetSpent).toBe(0);

		const allowed = await port.allow({ universeId, kind: 'brief', credits: 5 });
		expect(allowed).toBe(true);

		const spent = await port.spend({
			universeId,
			kind: 'brief',
			subjectEntityId: null,
			credits: 5
		});
		expect(spent).toBe(true);

		const after = await getBalance(db, userId);
		expect(after.warmBudgetSpent).toBe(5);
		expect(after.subscriptionCredits).toBe(before.subscriptionCredits); // never touches interactive credits
	});

	it('refuses and returns false rather than throwing once the balance is exhausted', async () => {
		const userId = await createTestUser(db);
		const universeId = await createTestUniverse(db, userId);
		const port = createDbWarmBudgetPort(db);

		const balance = await getBalance(db, userId);
		const tooMuch = balance.warmBudgetCredits + 1;

		expect(await port.allow({ universeId, kind: 'brief', credits: tooMuch })).toBe(false);
		expect(
			await port.spend({ universeId, kind: 'brief', subjectEntityId: null, credits: tooMuch })
		).toBe(false);

		const after = await getBalance(db, userId);
		expect(after.warmBudgetSpent).toBe(0); // the failed spend never landed
	});
});
