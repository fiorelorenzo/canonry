// The negotiation order is the part every other surface trusts, so it is asserted here once
// rather than re-derived per route. SPEC.md §17: an explicit choice, then a cookie for a
// visitor with no account, then the browser's header, then English, and an explicit choice
// beats the header forever after.
import { describe, expect, it } from 'vitest';
import { negotiateLocale, parseAcceptLanguage, toLocale } from './locale.js';

describe('negotiateLocale (issue #120, SPEC.md §17)', () => {
	it('prefers the account over everything, which is what makes a switcher feel honest', () => {
		expect(
			negotiateLocale({ accountPreference: 'en', cookie: 'it', acceptLanguage: 'it-IT,it;q=0.9' })
		).toBe('en');
	});

	it('uses the cookie for a visitor with no account', () => {
		expect(negotiateLocale({ cookie: 'it', acceptLanguage: 'en-GB,en;q=0.9' })).toBe('it');
	});

	it('falls back to the header when nobody has chosen', () => {
		expect(negotiateLocale({ acceptLanguage: 'it-CH,it;q=0.9,en;q=0.6' })).toBe('it');
	});

	it("respects the client's own quality order rather than the string order", () => {
		expect(negotiateLocale({ acceptLanguage: 'en;q=0.4,it;q=0.9' })).toBe('it');
	});

	it('skips languages we do not serve instead of failing', () => {
		expect(negotiateLocale({ acceptLanguage: 'de-DE,de;q=0.9,it;q=0.5' })).toBe('it');
		expect(negotiateLocale({ acceptLanguage: 'de,fr;q=0.8' })).toBe('en');
	});

	it('ends at English with nothing to go on', () => {
		expect(negotiateLocale({})).toBe('en');
		expect(negotiateLocale({ accountPreference: '', cookie: null, acceptLanguage: '' })).toBe('en');
	});

	it('treats a dropped locale as nobody having chosen, rather than throwing on a page load', () => {
		expect(negotiateLocale({ accountPreference: 'de', acceptLanguage: 'it' })).toBe('it');
	});

	it('survives a hostile header, because this runs on every request', () => {
		expect(negotiateLocale({ acceptLanguage: ',,;q=,it;q=notanumber' })).toBe('en');
		expect(parseAcceptLanguage('*')).toEqual([{ tag: '*', quality: 1 }]);
		expect(negotiateLocale({ acceptLanguage: '*' })).toBe('en');
	});
});

describe('toLocale', () => {
	it('narrows a stored regional tag to what we serve', () => {
		expect(toLocale('it-CH')).toBe('it');
		expect(toLocale('EN_US')).toBe('en');
	});

	it('answers null for unknown, empty and missing values alike', () => {
		expect(toLocale('de')).toBeNull();
		expect(toLocale('')).toBeNull();
		expect(toLocale(null)).toBeNull();
		expect(toLocale(undefined)).toBeNull();
	});
});
