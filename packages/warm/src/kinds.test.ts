import { describe, expect, it } from 'vitest';
import { assertWarmable, NotWarmableError } from './kinds.js';

describe('assertWarmable', () => {
	it('accepts every warm_artifact_kind value', () => {
		for (const kind of ['brief', 'npc_draft', 'ambient_pack', 'portrait', 'context_pack']) {
			expect(() => assertWarmable(kind)).not.toThrow();
		}
	});

	it('refuses a propagation diff - SPEC §8.1 never pre-computes what depends on input', () => {
		expect(() => assertWarmable('propagation_diff')).toThrow(NotWarmableError);
	});

	it('refuses a Loremaster answer for the same reason', () => {
		expect(() => assertWarmable('loremaster_answer')).toThrow(NotWarmableError);
	});

	it('refuses an empty or garbage string rather than passing it through', () => {
		expect(() => assertWarmable('')).toThrow(NotWarmableError);
		expect(() => assertWarmable('not-a-real-kind')).toThrow(NotWarmableError);
	});
});
