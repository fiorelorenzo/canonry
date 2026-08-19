import { describe, expect, it } from 'vitest';
import { keepRequestSchema } from './keep-request';

/** Issue #290: the shape #285's composer posts to `POST /w/<universe>/ask/keep`. These assert
 * the contract itself, since another surface is written against it. */
describe('keep request', () => {
	const valid = {
		question: 'Who holds the Ashen Ledger to account?',
		answer: 'Aldric Vane does, by keeping it afraid.',
		detailLevel: 'normal',
		askedFromPath: '/w/valdoria-reach/e/aldric-vane',
		sources: [
			{
				kind: 'own_canon',
				entityId: '11111111-1111-4111-8111-111111111111',
				statement: 'Aldric Vane keeps the Ledger honest by keeping it afraid.'
			}
		]
	};

	it('accepts an answer with an own canon citation', () => {
		const parsed = keepRequestSchema.parse(valid);
		expect(parsed.sources[0]).toEqual(valid.sources[0]);
		expect(parsed.askedFromPath).toBe('/w/valdoria-reach/e/aldric-vane');
	});

	it('accepts an answer kept with no sources at all', () => {
		const parsed = keepRequestSchema.parse({ ...valid, sources: undefined });
		expect(parsed.sources).toEqual([]);
	});

	it('defaults an indexed citation with no corpus id to null rather than rejecting it', () => {
		const parsed = keepRequestSchema.parse({
			...valid,
			sources: [
				{
					kind: 'indexed',
					pageTitle: 'Waterdeep',
					url: 'https://forgottenrealms.fandom.com/wiki/Waterdeep',
					statement: 'Waterdeep is governed by the Lords of Waterdeep.'
				}
			]
		});
		expect(parsed.sources[0]).toMatchObject({ kind: 'indexed', dataSourceId: null });
	});

	// The provider is guardrail 5's claim about who generated this text, so it is resolved on
	// the server and a body that tries to set it contributes nothing.
	it('ignores a provider the caller tries to declare', () => {
		const parsed = keepRequestSchema.parse({ ...valid, provider: 'a-provider-i-made-up' });
		expect(parsed).not.toHaveProperty('provider');
	});

	it('rejects an absolute or protocol-relative asked-from path', () => {
		expect(
			keepRequestSchema.safeParse({ ...valid, askedFromPath: 'https://evil.invalid/w/x' }).success
		).toBe(false);
		expect(keepRequestSchema.safeParse({ ...valid, askedFromPath: '//evil.invalid' }).success).toBe(
			false
		);
	});

	it('rejects an empty question, an empty answer and an unknown detail level', () => {
		expect(keepRequestSchema.safeParse({ ...valid, question: '   ' }).success).toBe(false);
		expect(keepRequestSchema.safeParse({ ...valid, answer: '' }).success).toBe(false);
		expect(keepRequestSchema.safeParse({ ...valid, detailLevel: 'exhaustive' }).success).toBe(
			false
		);
	});

	it('rejects a citation with no statement, and one with no reference', () => {
		expect(
			keepRequestSchema.safeParse({
				...valid,
				sources: [{ kind: 'own_canon', entityId: valid.sources[0].entityId, statement: ' ' }]
			}).success
		).toBe(false);
		expect(
			keepRequestSchema.safeParse({
				...valid,
				sources: [{ kind: 'own_canon', statement: 'no entry to point at' }]
			}).success
		).toBe(false);
	});

	it('refuses a source list long enough to be an attack rather than an answer', () => {
		const many = Array.from({ length: 25 }, () => valid.sources[0]);
		expect(keepRequestSchema.safeParse({ ...valid, sources: many }).success).toBe(false);
	});
});
