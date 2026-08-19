import { describe, expect, it } from 'vitest';
import { decorateMarkdown } from './decorate';
import type { MentionTarget } from '../../markdown';

const TARGETS: MentionTarget[] = [
	{ name: 'The Ashen Ledger', slug: 'the-ashen-ledger', aliases: [] }
];

describe('decorateMarkdown', () => {
	it('preserves every character of the source, so it can back a transparent textarea', () => {
		const source =
			'He **answers** to [[The Ashen Ledger]] now.\n\n## Standing\n\n> a quote\n- one\n- two';
		expect(decorateMarkdown(source, TARGETS).replace(/<[^>]+>/g, '')).toBe(source);
	});

	it('decorates bold text while keeping the asterisks visible', () => {
		const html = decorateMarkdown('He **answers** now.', []);
		expect(html).toContain('<span class="font-bold text-ink">**answers**</span>');
	});

	it('decorates a resolved mention distinctly from an unresolved one', () => {
		const resolved = decorateMarkdown('[[The Ashen Ledger]]', TARGETS);
		const unresolved = decorateMarkdown('[[Nobody Here]]', TARGETS);
		expect(resolved).toContain('text-accent-ink');
		expect(unresolved).toContain('text-danger');
		expect(unresolved).toContain('border-dashed');
	});

	it('decorates a heading line without consuming the # markers', () => {
		const html = decorateMarkdown('## Standing in the city', []);
		expect(html).toContain('##');
		expect(html).toContain('Standing in the city');
	});

	it('decorates image markdown like a link, leading ! included', () => {
		const html = decorateMarkdown('See ![the Rat](/w/w1/e/rat/media/a1) below.', []);
		expect(html).toContain(
			'<span class="text-accent-ink underline decoration-line-2">![the Rat](/w/w1/e/rat/media/a1)</span>'
		);
	});
});
