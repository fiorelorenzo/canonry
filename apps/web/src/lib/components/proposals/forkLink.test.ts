/**
 * Issue #648: the shipped-refusal notice's link carries the type and the pair, and only
 * what the refusal actually named.
 *
 * The pair is what makes the link a route rather than a page: the settings dialog opens
 * with those boxes checked, so a GM does not have to remember which end was short. Sending
 * an end the refusal did not name would pre-check a widening nobody asked for, which is the
 * same guardrail-1 mistake as widening a type without being asked.
 */
import { describe, expect, it } from 'vitest';
import { shippedForkQuery } from './forkLink';

describe('shippedForkQuery (issue #648)', () => {
	it('carries the type and both ends when neither is admitted', () => {
		expect(
			shippedForkQuery({ relationTypeId: 'abc', addFrom: 'faction', addTo: 'character' })
		).toBe('?fork=abc&addFrom=faction&addTo=character');
	});

	it('omits the end the refusal did not name', () => {
		expect(shippedForkQuery({ relationTypeId: 'abc', addFrom: null, addTo: 'item' })).toBe(
			'?fork=abc&addTo=item'
		);
		expect(shippedForkQuery({ relationTypeId: 'abc', addFrom: 'place', addTo: null })).toBe(
			'?fork=abc&addFrom=place'
		);
	});

	it('escapes the id rather than trusting it into a url', () => {
		expect(shippedForkQuery({ relationTypeId: 'a b&c', addFrom: null, addTo: null })).toBe(
			'?fork=a+b%26c'
		);
	});
});
