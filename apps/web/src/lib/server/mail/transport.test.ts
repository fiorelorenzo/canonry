/**
 * `ResendMailTransport` against a local HTTP stub standing in for the real Resend API
 * (mirrors `packages/media/src/audio/provider.test.ts`'s own pattern for the sibling
 * REST provider) - the real Resend API is never reached here. `FakeMailTransport` is
 * exercised directly too, since it is what every other test in this app (reset-password
 * flow included) stands in for the real transport with.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	FakeMailTransport,
	MailSendError,
	MissingResendEnvError,
	readResendConfig,
	ResendMailTransport
} from './transport.js';

const MESSAGE = {
	to: 'lorenzo.fiore@sencare.io',
	subject: 'Reset your Canonry password',
	text: 'plain text body',
	html: '<p>html body</p>'
};

describe('readResendConfig (#151)', () => {
	it('reads RESEND_API_KEY and MAIL_FROM from the given environment', () => {
		expect(
			readResendConfig({ RESEND_API_KEY: 're_test_key', MAIL_FROM: 'Canonry <noreply@canonry.io>' })
		).toEqual({ apiKey: 're_test_key', from: 'Canonry <noreply@canonry.io>' });
	});

	it('throws MissingResendEnvError when either variable is unset', () => {
		expect(() => readResendConfig({})).toThrow(MissingResendEnvError);
		expect(() => readResendConfig({ RESEND_API_KEY: 're_test_key' })).toThrow(
			MissingResendEnvError
		);
		expect(() => readResendConfig({ MAIL_FROM: 'Canonry <noreply@canonry.io>' })).toThrow(
			MissingResendEnvError
		);
	});
});

describe('ResendMailTransport against a local stub (#151)', () => {
	let server: http.Server;
	let baseUrl: string;
	let received: { headers: http.IncomingHttpHeaders; body: unknown } | undefined;
	let responseStatus = 200;
	let responseBody: unknown = { id: 'stub-message-id' };

	beforeEach(async () => {
		received = undefined;
		responseStatus = 200;
		responseBody = { id: 'stub-message-id' };
		server = http.createServer((req, res) => {
			const chunks: Buffer[] = [];
			req.on('data', (chunk) => chunks.push(chunk));
			req.on('end', () => {
				received = {
					headers: req.headers,
					body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
				};
				res.writeHead(responseStatus, { 'content-type': 'application/json' });
				res.end(JSON.stringify(responseBody));
			});
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});

	afterEach(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it('POSTs to /emails with the bearer key, MAIL_FROM and the message, returning the real id', async () => {
		const transport = new ResendMailTransport({
			env: { RESEND_API_KEY: 're_test_key', MAIL_FROM: 'Canonry <noreply@canonry.io>' },
			baseUrl
		});
		const sent = await transport.send(MESSAGE);

		expect(sent).toEqual({ id: 'stub-message-id' });
		expect(received?.headers.authorization).toBe('Bearer re_test_key');
		expect(received?.body).toEqual({
			from: 'Canonry <noreply@canonry.io>',
			to: [MESSAGE.to],
			subject: MESSAGE.subject,
			text: MESSAGE.text,
			html: MESSAGE.html
		});
	});

	it('throws MailSendError, carrying the status, when Resend answers non-2xx', async () => {
		responseStatus = 422;
		responseBody = { message: 'invalid `to` field' };
		const transport = new ResendMailTransport({
			env: { RESEND_API_KEY: 're_test_key', MAIL_FROM: 'Canonry <noreply@canonry.io>' },
			baseUrl
		});

		await expect(transport.send(MESSAGE)).rejects.toThrow(MailSendError);
		await expect(transport.send(MESSAGE)).rejects.toMatchObject({ status: 422 });
	});

	it('throws MissingResendEnvError without ever reaching the network when unconfigured', async () => {
		const transport = new ResendMailTransport({ env: {}, baseUrl });
		await expect(transport.send(MESSAGE)).rejects.toThrow(MissingResendEnvError);
		expect(received).toBeUndefined();
	});
});

describe('FakeMailTransport (#151)', () => {
	it('records every message sent and returns a distinct fake id per call', async () => {
		const transport = new FakeMailTransport();
		const first = await transport.send(MESSAGE);
		const second = await transport.send({ ...MESSAGE, to: 'someone.else@example.com' });

		expect(transport.sent).toEqual([MESSAGE, { ...MESSAGE, to: 'someone.else@example.com' }]);
		expect(first.id).not.toBe(second.id);
	});

	it('throws instead of recording when configured to fail', async () => {
		const transport = new FakeMailTransport({ fail: true });
		await expect(transport.send(MESSAGE)).rejects.toThrow(MailSendError);
		expect(transport.sent).toEqual([]);
	});
});
