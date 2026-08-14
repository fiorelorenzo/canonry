/**
 * parseAmbientLayers against the real Postgres this box runs, with a scripted
 * MockLanguageModelV4 standing in for the actual 'cheap' purpose model - the same
 * pattern packages/copilot's ranking.test.ts and diffs.test.ts use for their own
 * generateObject calls, since ai-gateway-provider's own request/response shape has
 * nothing left to prove here beyond what @canonry/ai's own test suite already covers.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, eq, sql, type Db } from '@canonry/db';
import { modelCall, modelConfig, universe, user } from '@canonry/db/schema';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModel } from 'ai';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AMBIENT_LAYERS_OPERATION, parseAmbientLayers } from './layers.js';
import { openTestDb } from '../test-db.js';

function unique(prefix: string): string {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

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

function scriptedModel(object: unknown): LanguageModel {
	return new MockLanguageModelV4({
		provider: 'test',
		modelId: 'test-cheap',
		doGenerate: {
			content: [{ type: 'text', text: JSON.stringify(object) }],
			finishReason: { unified: 'stop', raw: undefined },
			usage: usage(90, 60),
			warnings: []
		}
	}) as unknown as LanguageModel;
}

describe('parseAmbientLayers (#68, SPEC.md §8.2)', () => {
	let db: Db;
	let userId: string;
	let universeId: string;

	beforeAll(async () => {
		db = openTestDb();
		userId = unique('layers-test-user');
		await db
			.insert(user)
			.values({ id: userId, name: 'Layers Test Owner', email: `${userId}@example.test` });
	});

	afterAll(async () => {
		await db.delete(user).where(eq(user.id, userId));
		await closeDb(db);
	});

	beforeEach(async () => {
		// One active row per purpose is a unique index, and vitest runs this package's files in
		// parallel against one database, so this used to `delete(modelConfig)` wholesale and
		// insert. That deleted a sibling file's row mid-test: this file and layers.test.ts both
		// want an active `cheap` row, and embedding.test.ts wants an `embedding` one. Upserting
		// the single row this file needs leaves every other purpose alone.
		await db
			.insert(modelConfig)
			.values({
				purpose: 'cheap',
				provider: 'test-provider',
				modelId: 'test-cheap',
				active: true,
				params: {}
			})
			.onConflictDoUpdate({
				target: modelConfig.purpose,
				targetWhere: sql`${modelConfig.active} = true`,
				set: { provider: 'test-provider', modelId: 'test-cheap', params: {} }
			});

		const [world] = await db
			.insert(universe)
			.values({
				ownerUserId: userId,
				name: 'Layers Test Universe',
				slug: unique('layers-test-universe'),
				kind: 'homebrew',
				aiEnabled: true
			})
			.returning();
		if (!world) throw new Error('universe insert did not return a row');
		universeId = world.id;
	});

	afterEach(async () => {
		await db.delete(universe).where(eq(universe.id, universeId));
	});

	it('decomposes a description into layers, charged at zero credits (#68)', async () => {
		const languageModel = scriptedModel({
			layers: [
				{ prompt: 'gentle rain falling on leaves', loopType: 'continuous', volume: 0.6 },
				{
					prompt: 'distant thunder rumble',
					loopType: 'interval',
					intervalMinSeconds: 15,
					intervalMaxSeconds: 45,
					volume: 0.5
				}
			]
		});

		const layers = await parseAmbientLayers({
			db,
			languageModel: () => languageModel,
			description: 'A rainy dockside at night, with distant thunder rolling in.',
			userId,
			universeId
		});

		expect(layers).toEqual([
			{ prompt: 'gentle rain falling on leaves', loopType: 'continuous', volume: 0.6 },
			{
				prompt: 'distant thunder rumble',
				loopType: 'interval',
				intervalMinSeconds: 15,
				intervalMaxSeconds: 45,
				volume: 0.5
			}
		]);

		const calls = await db
			.select()
			.from(modelCall)
			.where(eq(modelCall.operation, AMBIENT_LAYERS_OPERATION));
		const mine = calls.filter((c) => c.userId === userId);
		expect(mine).toHaveLength(1);
		expect(mine[0]?.agent).toBe('media');
		// H1 (docs/ux/DECISIONS.md): free to the user, but still recorded with its real
		// tokens - the "zero-credit call still records its tokens and cost" rule.
		expect(mine[0]?.credits).toBe(0);
		expect(mine[0]?.inputTokens).toBe(90);
		expect(mine[0]?.outputTokens).toBe(60);
	});

	it('passes the resolved cheap-purpose provider/modelId to the injected factory', async () => {
		const seen: Array<{ provider: string; modelId: string }> = [];
		const languageModel = scriptedModel({
			layers: [{ prompt: 'wind through the trees', loopType: 'continuous', volume: 0.4 }]
		});

		await parseAmbientLayers({
			db,
			languageModel: (provider, modelId) => {
				seen.push({ provider, modelId });
				return languageModel;
			},
			description: 'A quiet forest clearing.',
			userId,
			universeId
		});

		expect(seen).toEqual([{ provider: 'test-provider', modelId: 'test-cheap' }]);
	});
});
