import { describe, expect, it } from 'vitest';
import { computeFingerprint } from './fingerprint.js';

describe('computeFingerprint', () => {
	it('changes when a source revision id changes', () => {
		const before = computeFingerprint({
			sourceRevisionIds: ['rev-a'],
			promptVersion: 'brief-v1',
			modelId: 'gpt-mini'
		});
		const after = computeFingerprint({
			sourceRevisionIds: ['rev-b'],
			promptVersion: 'brief-v1',
			modelId: 'gpt-mini'
		});
		expect(after).not.toBe(before);
	});

	it('is stable for the same inputs and not otherwise affected by anything else', () => {
		const input = {
			sourceRevisionIds: ['rev-a', 'rev-b'],
			promptVersion: 'brief-v1',
			modelId: 'gpt-mini'
		};
		expect(computeFingerprint(input)).toBe(computeFingerprint({ ...input }));
		expect(computeFingerprint(input)).toBe(computeFingerprint(input));
	});

	it('does not depend on the order sources were listed in', () => {
		const a = computeFingerprint({
			sourceRevisionIds: ['rev-a', 'rev-b'],
			promptVersion: 'brief-v1',
			modelId: 'gpt-mini'
		});
		const b = computeFingerprint({
			sourceRevisionIds: ['rev-b', 'rev-a'],
			promptVersion: 'brief-v1',
			modelId: 'gpt-mini'
		});
		expect(a).toBe(b);
	});

	it('changes when the prompt version changes, sources held constant', () => {
		const a = computeFingerprint({
			sourceRevisionIds: ['rev-a'],
			promptVersion: 'brief-v1',
			modelId: 'gpt-mini'
		});
		const b = computeFingerprint({
			sourceRevisionIds: ['rev-a'],
			promptVersion: 'brief-v2',
			modelId: 'gpt-mini'
		});
		expect(a).not.toBe(b);
	});

	it('changes when the model id changes, sources held constant', () => {
		const a = computeFingerprint({
			sourceRevisionIds: ['rev-a'],
			promptVersion: 'brief-v1',
			modelId: 'gpt-mini'
		});
		const b = computeFingerprint({
			sourceRevisionIds: ['rev-a'],
			promptVersion: 'brief-v1',
			modelId: 'gpt-large'
		});
		expect(a).not.toBe(b);
	});

	it('treats a missing revision (null) as part of the fingerprint rather than ignoring it', () => {
		const withRevision = computeFingerprint({
			sourceRevisionIds: ['rev-a'],
			promptVersion: 'brief-v1',
			modelId: 'gpt-mini'
		});
		const withoutRevision = computeFingerprint({
			sourceRevisionIds: [null],
			promptVersion: 'brief-v1',
			modelId: 'gpt-mini'
		});
		expect(withoutRevision).not.toBe(withRevision);
	});
});
