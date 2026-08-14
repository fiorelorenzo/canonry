import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InvalidWebhookSignatureError, verifyStripeSignature } from './stripe-signature.js';

const SECRET = 'whsec_test_00000000000000000000000000000000';

function sign(rawBody: string, timestampSeconds: number, secret = SECRET): string {
	const hex = createHmac('sha256', secret)
		.update(`${timestampSeconds}.${rawBody}`, 'utf8')
		.digest('hex');
	return `t=${timestampSeconds},v1=${hex}`;
}

describe('verifyStripeSignature', () => {
	it('accepts a correctly signed, fresh payload', () => {
		const body = '{"id":"evt_1","type":"invoice.paid"}';
		const nowSeconds = 1_800_000_000;
		const header = sign(body, nowSeconds);

		expect(() =>
			verifyStripeSignature(body, header, SECRET, { now: () => nowSeconds * 1000 })
		).not.toThrow();
	});

	it('rejects a missing header', () => {
		expect(() => verifyStripeSignature('{}', null, SECRET)).toThrow(InvalidWebhookSignatureError);
	});

	it('rejects a header with no v1 signature', () => {
		expect(() => verifyStripeSignature('{}', 't=1800000000', SECRET)).toThrow(
			InvalidWebhookSignatureError
		);
	});

	it('rejects a body that does not match what was signed - the tamper case', () => {
		const nowSeconds = 1_800_000_000;
		const header = sign('{"id":"evt_1"}', nowSeconds);

		expect(() =>
			verifyStripeSignature('{"id":"evt_2"}', header, SECRET, { now: () => nowSeconds * 1000 })
		).toThrow(InvalidWebhookSignatureError);
	});

	it('rejects a signature computed with the wrong secret', () => {
		const body = '{"id":"evt_1"}';
		const nowSeconds = 1_800_000_000;
		const header = sign(body, nowSeconds, 'whsec_a_totally_different_secret_000000');

		expect(() =>
			verifyStripeSignature(body, header, SECRET, { now: () => nowSeconds * 1000 })
		).toThrow(InvalidWebhookSignatureError);
	});

	it('rejects a signature older than the tolerance window - a replayed header', () => {
		const body = '{"id":"evt_1"}';
		const signedAt = 1_800_000_000;
		const header = sign(body, signedAt);
		const tenMinutesLater = (signedAt + 600) * 1000;

		expect(() =>
			verifyStripeSignature(body, header, SECRET, {
				now: () => tenMinutesLater,
				toleranceSeconds: 300
			})
		).toThrow(/tolerance/);
	});

	it('accepts a second v1 entry matching a rotated secret, when the first does not match', () => {
		const body = '{"id":"evt_1"}';
		const nowSeconds = 1_800_000_000;
		const oldHex = createHmac('sha256', 'whsec_old_0000000000000000000000000000')
			.update(`${nowSeconds}.${body}`, 'utf8')
			.digest('hex');
		const newHex = createHmac('sha256', SECRET)
			.update(`${nowSeconds}.${body}`, 'utf8')
			.digest('hex');
		const header = `t=${nowSeconds},v1=${oldHex},v1=${newHex}`;

		expect(() =>
			verifyStripeSignature(body, header, SECRET, { now: () => nowSeconds * 1000 })
		).not.toThrow();
	});
});
