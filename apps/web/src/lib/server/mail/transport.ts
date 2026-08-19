/**
 * Mail transport, behind an interface (#151, mirroring `packages/media`'s ImageProvider/
 * AudioProvider seam and `packages/import`'s Driver seam): one interface, one real
 * implementation, one test double. The transport itself is a product decision made once
 * for every use that ever has to reach an address outside this app - password reset
 * today, email verification, a shared-universe invitation and an import-finished notice
 * later - so `send` stays one generic message shape rather than growing a method per
 * use. Only password reset calls it yet: a `sendInvitation` that did nothing would be
 * dishonest scaffolding, an interface with a single caller is not.
 *
 * The real implementation goes straight to Resend's REST API (`https://api.resend.com`,
 * `Authorization: Bearer <key>`), not through Vercel AI Gateway - the gateway routes text
 * and embedding calls, not transactional mail, the same reasoning `packages/media`'s
 * Replicate and ElevenLabs providers already carry for images and sound.
 */

export interface MailMessage {
	to: string;
	subject: string;
	text: string;
	html: string;
}

export interface SentMail {
	/** The provider's own message id - safe to log and to show a caller, unlike the
	 * credential that sent it. */
	id: string;
}

export interface MailTransport {
	send(message: MailMessage): Promise<SentMail>;
}

export class MissingResendEnvError extends Error {
	constructor() {
		super(
			'missing required env var RESEND_API_KEY or MAIL_FROM: mail cannot be sent without ' +
				'both configured (see .env.example).'
		);
		this.name = 'MissingResendEnvError';
	}
}

/** Read lazily, inside `ResendMailTransport.send`, never at construction - this transport
 * is wired into `$lib/server/auth.ts`'s module-level `betterAuth()` call, which
 * SvelteKit's postbuild route analysis imports with no environment behind it (see that
 * file's own doc comment on `building`). Throwing here at construction time would fail
 * `vite build` on every worktree and every CI run that has no Resend credential, not only
 * the ones that actually try to send - the same reasoning `packages/media/src/audio/
 * provider.ts`'s `readElevenLabsApiToken` already documents for its own lazy read. */
export function readResendConfig(env: NodeJS.ProcessEnv = process.env): {
	apiKey: string;
	from: string;
} {
	const apiKey = env.RESEND_API_KEY;
	const from = env.MAIL_FROM;
	if (!apiKey || !from) throw new MissingResendEnvError();
	return { apiKey, from };
}

export class MailSendError extends Error {
	constructor(
		public readonly status: number,
		message: string
	) {
		super(`Resend request failed with status ${status}: ${message}`);
		this.name = 'MailSendError';
	}
}

/** Overridable via `ResendMailTransportDeps.baseUrl` so a test can point this at a local
 * HTTP stub instead of the network - the same test-only override `packages/media/src/
 * audio/provider.ts`'s `ELEVENLABS_API_BASE_URL` already threads through. */
const RESEND_API_BASE_URL = 'https://api.resend.com';

export interface ResendMailTransportDeps {
	env?: NodeJS.ProcessEnv;
	baseUrl?: string;
}

/**
 * The real path (#151). `canonry.io` itself is the verified sending domain, DKIM and SPF
 * both green, `MAIL_FROM` set to `Canonry <noreply@canonry.io>` - set up once outside
 * this repo, nothing about the domain is this class's job.
 */
export class ResendMailTransport implements MailTransport {
	constructor(private readonly deps: ResendMailTransportDeps = {}) {}

	async send(message: MailMessage): Promise<SentMail> {
		const { apiKey, from } = readResendConfig(this.deps.env);
		const baseUrl = this.deps.baseUrl ?? RESEND_API_BASE_URL;
		const response = await fetch(`${baseUrl}/emails`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${apiKey}`
			},
			body: JSON.stringify({
				from,
				to: [message.to],
				subject: message.subject,
				text: message.text,
				html: message.html
			})
		});
		if (!response.ok) {
			// Body may echo the request back (mail content included) - never let it reach the
			// logger, only the status code and a truncated length do (mirrors
			// packages/media/src/audio/provider.ts's ElevenLabsRequestError).
			const bodyText = await response.text();
			throw new MailSendError(response.status, `${bodyText.length} byte body`);
		}
		const data = (await response.json()) as { id: string };
		// Never the credential, never the content - the provider's own message id is the
		// honest way to show a send worked (#151: "show the provider's own response id or
		// status, not the credential").
		console.info('mail sent via Resend, id:', data.id);
		return { id: data.id };
	}
}

/** Reads `RESEND_API_KEY`/`MAIL_FROM` from the environment passed in, same shape as
 * `$lib/server/auth.ts`'s `buildSocialProviders(env)` - a pure factory the caller wires
 * into whatever needs to send mail, never a hidden `process.env` read of its own. */
export function buildMailTransport(env: NodeJS.ProcessEnv): MailTransport {
	return new ResendMailTransport({ env });
}

/**
 * Test double (mirrors `packages/media/src/provider.ts`'s `FakeImageProvider` and
 * `packages/media/src/audio/provider.ts`'s `FakeAudioProvider`). Never touches the
 * network; records every message sent so a test can assert on recipient/subject/body,
 * and can be configured to fail so the loud-failure path (#151: "never a green
 * check-your-inbox over a mail that never left") has something real to fail against.
 */
export class FakeMailTransport implements MailTransport {
	readonly sent: MailMessage[] = [];

	constructor(private readonly options: { fail?: boolean } = {}) {}

	async send(message: MailMessage): Promise<SentMail> {
		if (this.options.fail) {
			throw new MailSendError(500, 'fake transport configured to fail');
		}
		this.sent.push(message);
		return { id: `fake-${this.sent.length}` };
	}
}
