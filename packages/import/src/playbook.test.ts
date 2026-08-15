import { describe, expect, it } from 'vitest';
import {
	loadBuiltinPlaybook,
	loadPlaybook,
	playbookVersion,
	PlaybookParseError,
	PlaybookValidationError
} from './playbook.js';

const VALID_SOURCE = `---
id: fixture
version: 3
name: Fixture playbook
description: A minimal playbook used only by tests.
modelPurpose: premium
stepBudget: 12
---

# Fixture playbook

Body text the model reads as its system prompt.

## Inputs

One document, bound by the job.

## Tools

- \`source_read\` - read a file.
- \`entity_propose\` - propose an entity.
- \`checkpoint\` - checkpoint progress.
- \`job_finish\` - close the run.

## Steps

1. Read the document.

   \`\`\`json
   { "path": "notes.md" }
   \`\`\`

2. Finish.
`;

describe('loadPlaybook', () => {
	it('parses frontmatter, tool list and system prompt from a well-formed playbook', () => {
		const playbook = loadPlaybook(VALID_SOURCE);

		expect(playbook.id).toBe('fixture');
		expect(playbook.version).toBe(3);
		expect(playbook.name).toBe('Fixture playbook');
		expect(playbook.description).toBe('A minimal playbook used only by tests.');
		expect(playbook.modelPurpose).toBe('premium');
		expect(playbook.stepBudget).toBe(12);
		expect(playbook.tools).toEqual(['source_read', 'entity_propose', 'checkpoint', 'job_finish']);
		expect(playbook.systemPrompt).toContain('# Fixture playbook');
		expect(playbook.systemPrompt).toContain('Body text the model reads as its system prompt.');
		expect(playbook.systemPrompt.startsWith('---')).toBe(false);
	});

	it('defaults modelPurpose to cheap when the frontmatter omits it', () => {
		const source = VALID_SOURCE.replace('modelPurpose: premium\n', '');
		expect(loadPlaybook(source).modelPurpose).toBe('cheap');
	});

	it('exposes version through the playbookVersion accessor (SPEC 4.6, 6.2, 6.4 fingerprint)', () => {
		expect(playbookVersion(loadPlaybook(VALID_SOURCE))).toBe(3);
	});

	it('rejects a file with no frontmatter fence', () => {
		expect(() => loadPlaybook('# just markdown\n')).toThrow(PlaybookParseError);
	});

	it('rejects an unclosed frontmatter fence', () => {
		expect(() => loadPlaybook('---\nid: x\n# body\n')).toThrow(PlaybookParseError);
	});

	it('rejects a frontmatter version that is not a positive integer', () => {
		const source = VALID_SOURCE.replace('version: 3', 'version: 1.5');
		expect(() => loadPlaybook(source)).toThrow(PlaybookValidationError);
	});

	it('rejects a stepBudget above the 200 ceiling', () => {
		const source = VALID_SOURCE.replace('stepBudget: 12', 'stepBudget: 500');
		expect(() => loadPlaybook(source)).toThrow(PlaybookValidationError);
	});

	it('rejects a playbook missing the "## Tools" section', () => {
		const source = VALID_SOURCE.replace(/## Tools[\s\S]*?## Steps/, '## Steps');
		expect(() => loadPlaybook(source)).toThrow(PlaybookValidationError);
	});

	it('rejects required sections out of order', () => {
		// Swap "## Inputs" and "## Tools" so Tools comes before Inputs.
		const source = VALID_SOURCE.replace('## Inputs', '## TEMP')
			.replace('## Tools', '## Inputs')
			.replace('## TEMP', '## Tools');
		expect(() => loadPlaybook(source)).toThrow(PlaybookValidationError);
	});

	it('rejects a "## Tools" bullet naming a tool outside SPEC.md §6.3\'s surface', () => {
		const source = VALID_SOURCE.replace(
			'- `checkpoint` - checkpoint progress.',
			'- `shell_exec` - run a command.'
		);
		expect(() => loadPlaybook(source)).toThrow(PlaybookValidationError);
	});

	it('rejects "## Steps" with no fenced json example', () => {
		const source = VALID_SOURCE.replace(/```json[\s\S]*?```/, '');
		expect(() => loadPlaybook(source)).toThrow(PlaybookValidationError);
	});

	it('rejects "## Steps" whose fenced json example does not parse', () => {
		const source = VALID_SOURCE.replace('{ "path": "notes.md" }', '{ path: notes.md ');
		expect(() => loadPlaybook(source)).toThrow(PlaybookValidationError);
	});

	it('rejects a frontmatter id that does not match the expected id', () => {
		expect(() => loadPlaybook(VALID_SOURCE, { expectedId: 'other' })).toThrow(
			PlaybookValidationError
		);
	});
});

describe('loadBuiltinPlaybook', () => {
	it('loads the shipped generic playbook and validates against the real §6.3 tool surface', async () => {
		const playbook = await loadBuiltinPlaybook('generic');

		expect(playbook.id).toBe('generic');
		expect(playbook.version).toBe(2);
		expect(playbook.modelPurpose).toBe('cheap');
		expect(playbook.stepBudget).toBeGreaterThan(0);
		expect(playbook.tools).toEqual([
			'source_list',
			'source_read',
			'page_image',
			'image_store',
			'entity_propose',
			'relation_propose',
			'checkpoint',
			'job_finish'
		]);
		expect(playbook.systemPrompt).toContain('## Steps');
	});
});
