/**
 * Decision R6, round thirteen (#381): the suggestion module is pure precisely so it can be
 * tested without a component, a stream or a locale bundle. The fixture translations below
 * are deliberately not real copy - a wording change in `en.ts`/`it.ts` must never break
 * this file, only a change to which bucket a route lands in or which arguments a bucket
 * reads should.
 */
import { describe, expect, it } from 'vitest';
import { quickAskSuggestions, type QuickAskSuggestionMessages } from './quick-ask-suggestions';

const t: QuickAskSuggestionMessages = {
	entry: {
		summary: (name) => `summary:${name}`,
		connects: (type, name) => `connects:${type}:${name}`,
		gaps: (name) => `gaps:${name}`
	},
	world: {
		shape: 'world:shape',
		recent: 'world:recent',
		gaps: 'world:gaps'
	},
	proposals: {
		pending: 'proposals:pending',
		oldest: 'proposals:oldest',
		conflicts: 'proposals:conflicts'
	}
};

describe('quickAskSuggestions (#381, R6)', () => {
	it('reads about the entity on an entry route, entity type included', () => {
		const suggestions = quickAskSuggestions(
			{ routeId: '/w/[universe]/e/[slug]', entity: { name: 'Aldric Vane', type: 'character' } },
			t
		);
		expect(suggestions).toEqual([
			'summary:Aldric Vane',
			'connects:character:Aldric Vane',
			'gaps:Aldric Vane'
		]);
	});

	it('reads about the entity even off the entry route itself, e.g. the edit page', () => {
		// #381: the same narrowing the panel's own context line uses - presence of
		// `page.data.entity` decides this, not the route id, since `/e/[slug]/edit`
		// carries the entity too and is still "about that entry".
		const suggestions = quickAskSuggestions(
			{ routeId: '/w/[universe]/e/[slug]/edit', entity: { name: 'Cairnmouth', type: 'place' } },
			t
		);
		expect(suggestions[0]).toBe('summary:Cairnmouth');
	});

	it('reads about what is pending on the proposals route, no entity present', () => {
		const suggestions = quickAskSuggestions(
			{ routeId: '/w/[universe]/proposals', entity: null },
			t
		);
		expect(suggestions).toEqual(['proposals:pending', 'proposals:oldest', 'proposals:conflicts']);
	});

	it('keeps the proposals bucket for one proposal under review, not only the list', () => {
		const suggestions = quickAskSuggestions(
			{ routeId: '/w/[universe]/proposals/[plan]', entity: null },
			t
		);
		expect(suggestions).toEqual(['proposals:pending', 'proposals:oldest', 'proposals:conflicts']);
	});

	it('falls back to the world on /entries, no entity present', () => {
		const suggestions = quickAskSuggestions({ routeId: '/w/[universe]/entries', entity: null }, t);
		expect(suggestions).toEqual(['world:shape', 'world:recent', 'world:gaps']);
	});

	it('falls back to the world with no matched route at all', () => {
		const suggestions = quickAskSuggestions({ routeId: null, entity: null }, t);
		expect(suggestions).toEqual(['world:shape', 'world:recent', 'world:gaps']);
	});

	it('is always exactly three suggestions, in every bucket', () => {
		expect(quickAskSuggestions({ routeId: null, entity: null }, t)).toHaveLength(3);
		expect(
			quickAskSuggestions({ routeId: '/w/[universe]/proposals', entity: null }, t)
		).toHaveLength(3);
		expect(
			quickAskSuggestions(
				{ routeId: '/w/[universe]/e/[slug]', entity: { name: 'X', type: 'item' } },
				t
			)
		).toHaveLength(3);
	});
});
