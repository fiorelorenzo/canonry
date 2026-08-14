import { describe, expect, it } from 'vitest';
import { isThemePreference, parseThemePreference, themeAttribute } from './theme';

describe('isThemePreference', () => {
	it('accepts the three legal values', () => {
		expect(isThemePreference('light')).toBe(true);
		expect(isThemePreference('dark')).toBe(true);
		expect(isThemePreference('system')).toBe(true);
	});

	it('rejects anything else, including null and undefined', () => {
		expect(isThemePreference('sepia')).toBe(false);
		expect(isThemePreference(null)).toBe(false);
		expect(isThemePreference(undefined)).toBe(false);
	});
});

describe('parseThemePreference', () => {
	it('passes a legal cookie value through', () => {
		expect(parseThemePreference('dark')).toBe('dark');
	});

	it('falls back to system for a missing or garbled cookie', () => {
		expect(parseThemePreference(undefined)).toBe('system');
		expect(parseThemePreference(null)).toBe('system');
		expect(parseThemePreference('nope')).toBe('system');
	});
});

describe('themeAttribute', () => {
	it('passes light and dark straight through as the data-theme value', () => {
		expect(themeAttribute('light')).toBe('light');
		expect(themeAttribute('dark')).toBe('dark');
	});

	it('resolves system to no attribute, leaving the choice to CSS', () => {
		expect(themeAttribute('system')).toBeUndefined();
	});
});
