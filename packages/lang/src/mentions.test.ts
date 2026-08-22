import { describe, expect, it } from 'vitest';
import { stripMentionSyntax } from './mentions.js';

describe('stripMentionSyntax', () => {
	it('reduces a mention to its bare name for a display excerpt', () => {
		expect(stripMentionSyntax('after [[The Sable Winter]]')).toBe('after The Sable Winter');
	});

	it('leaves text with no mention syntax unchanged', () => {
		expect(stripMentionSyntax('plain prose only')).toBe('plain prose only');
	});

	it('strips every mention in a span that quotes more than one', () => {
		expect(stripMentionSyntax('[[Aldric Vane]] and [[The Ashen Ledger]]')).toBe(
			'Aldric Vane and The Ashen Ledger'
		);
	});
});
