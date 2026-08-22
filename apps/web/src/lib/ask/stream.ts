/**
 * Issue #285 (decision O3): the client half of Ask, in one module because there are now
 * two places that stream an answer, the dedicated route and the floating panel the pill
 * expands into, and a second copy of this SSE loop would drift from the first the day
 * `ask/+server.ts` grows an event.
 *
 * The event payloads are parsed rather than asserted. They mirror `runAsk`'s own types
 * (`packages/copilot/src/ask.ts`) instead of importing them, because that package is
 * server-side and this subtree has no shared types module with it, and a mirror that is
 * only a cast drifts silently. Parsing means a renamed field shows up as a dropped event
 * rather than as `undefined` rendered into the page. `done` carries `answer` and `credits`
 * too, which nothing here reads: the answer arrived token by token already.
 *
 * Nothing here writes anything. `keepAnswer` is the one call that does, and it posts the
 * `keepRequestSchema` shape from `$lib/server/ask/keep-request.ts` (#290): the universe,
 * the account, the locale and the provider are all resolved server-side, so a caller
 * cannot set the guardrail 5 disclosure that ends up beside the record.
 */
import { z } from 'zod';
import type { KeepRequestSource } from '$lib/server/ask/keep-request';

export type AskDetailLevel = '1_line' | 'short' | 'normal' | 'detailed' | 'full';

export const ASK_DETAIL_LEVELS: readonly AskDetailLevel[] = [
	'1_line',
	'short',
	'normal',
	'detailed',
	'full'
];

/** issue #380, decision R5: mirrors `AskHistoryTurn`/`AskContext` from
 * `packages/copilot/src/ask.ts` for the same reason every other type on this page does
 * (see this file's own header comment) - that package is server-side, and importing it
 * from here is the #197 mistake repeated. */
export interface AskHistoryTurn {
	role: 'gm' | 'loremaster';
	text: string;
}

export interface AskContext {
	kind: 'entry' | 'world';
	name: string;
	entityType?: string;
}

/** Issue #535: a citation is a sentence with its entry. `statement` is the whole of it and
 * arrives display-ready - `packages/copilot`'s `searchOwnCanon` draws it from one side of a
 * `:::secret` fence and strips `[[mention]]` syntax before it is sent, so nothing here has
 * to remember to clean it.
 *
 * No `score`, and no `spanStart`/`spanEnd`. The score is the confidence figure guardrail 3
 * and D6 both refuse, and a field on the wire is a field a component can render; the spans
 * were never read by anything and would be wrong against a stripped statement anyway. */
const ownCanonSourceSchema = z.object({
	kind: z.literal('own_canon'),
	entityId: z.string(),
	entityName: z.string(),
	entitySlug: z.string(),
	statement: z.string()
});

/** SPEC.md §7: `attribution` and `licence` are shown on every answer this source appears
 * in, a legal requirement rather than a nicety, which is why they are required here.
 *
 * Issue #535: `statement` is the one sentence of `text` the question touched, and it is
 * what the footer quotes; `text` is the whole retrieved chunk, which only the model sees.
 * The kept record stores `statement` too, so a stored citation is a sentence rather than
 * the paragraph it came out of. */
const indexedSourceSchema = z.object({
	kind: z.literal('indexed'),
	dataSourceId: z.string(),
	pageTitle: z.string(),
	breadcrumb: z.string(),
	url: z.string(),
	text: z.string(),
	statement: z.string(),
	attribution: z.string(),
	licence: z.string().nullable(),
	licenceUrl: z.string().nullable()
});

const askSourceSchema = z.discriminatedUnion('kind', [ownCanonSourceSchema, indexedSourceSchema]);

/** issue #256: a proposal `runAsk` drafted from a tool call the model made. */
const askProposalSchema = z.object({
	proposalId: z.string(),
	planId: z.string().nullable(),
	kind: z.enum(['draft_entity', 'update']),
	redirected: z.boolean(),
	entityName: z.string(),
	entitySlug: z.string(),
	summary: z.string()
});

/** issue #256: a tool call whose drafting call failed, rendered without depending on the
 * model narrating its own failure. */
const askProposalFailureSchema = z.object({
	tool: z.enum(['entry_propose', 'entry_edit_propose']),
	message: z.string()
});

const sourcesEventSchema = z.object({
	sources: z.array(askSourceSchema),
	followUps: z.array(z.string())
});
const tokenEventSchema = z.object({ delta: z.string() });
const doneEventSchema = z.object({
	generated: z.boolean(),
	provider: z.string().nullable(),
	modelId: z.string().nullable()
});
const errorEventSchema = z.object({ message: z.string() });

export type OwnCanonSource = z.infer<typeof ownCanonSourceSchema>;
export type IndexedSource = z.infer<typeof indexedSourceSchema>;
export type AskSource = z.infer<typeof askSourceSchema>;
export type AskProposalEvent = z.infer<typeof askProposalSchema>;
export type AskProposalFailure = z.infer<typeof askProposalFailureSchema>;
export type AskDone = z.infer<typeof doneEventSchema>;

export interface AskStreamHandlers {
	onSources?: (sources: AskSource[], followUps: string[]) => void;
	onToken?: (delta: string) => void;
	onProposal?: (proposal: AskProposalEvent) => void;
	onProposalFailure?: (failure: AskProposalFailure) => void;
	onDone?: (done: AskDone) => void;
	/** An `error` SSE event. The message is already in the reader's language: the server
	 * built it from its own catalogue, so no caller localises it a second time. */
	onError?: (message: string) => void;
}

/** The request never reached a stream at all (offline, 4xx, 5xx). Distinct from an
 * `error` event, which arrived over a stream that opened fine, so a caller can show its
 * own transport wording for the first and the server's message for the second. */
export class AskTransportError extends Error {
	constructor() {
		super('ask stream did not open');
		this.name = 'AskTransportError';
	}
}

/**
 * Reads one Ask SSE body to completion, calling the handlers as events arrive. Split out
 * from `streamAsk` so the framing is testable without a network: an event can straddle a
 * chunk boundary, which is the one thing a hand-written SSE reader gets wrong, and the
 * only way to prove it does not is to feed it chunks that straddle.
 */
export async function consumeAskStream(
	body: ReadableStream<Uint8Array>,
	handlers: AskStreamHandlers
): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const frames = buffer.split('\n\n');
		buffer = frames.pop() ?? '';
		for (const frame of frames) dispatch(frame, handlers);
	}
	// A body that ended without its trailing blank line still carries a whole event.
	if (buffer.trim().length > 0) dispatch(buffer, handlers);
}

function dispatch(frame: string, handlers: AskStreamHandlers): void {
	const lines = frame.split('\n');
	const eventLine = lines.find((line) => line.startsWith('event: '));
	const dataLine = lines.find((line) => line.startsWith('data: '));
	if (!eventLine || !dataLine) return;
	const name = eventLine.slice('event: '.length);
	let raw: unknown;
	try {
		raw = JSON.parse(dataLine.slice('data: '.length));
	} catch {
		return;
	}
	if (name === 'sources') {
		const parsed = sourcesEventSchema.safeParse(raw);
		if (parsed.success) handlers.onSources?.(parsed.data.sources, parsed.data.followUps);
	} else if (name === 'token') {
		const parsed = tokenEventSchema.safeParse(raw);
		if (parsed.success) handlers.onToken?.(parsed.data.delta);
	} else if (name === 'proposal') {
		const parsed = askProposalSchema.safeParse(raw);
		if (parsed.success) handlers.onProposal?.(parsed.data);
	} else if (name === 'proposal_failed') {
		const parsed = askProposalFailureSchema.safeParse(raw);
		if (parsed.success) handlers.onProposalFailure?.(parsed.data);
	} else if (name === 'done') {
		const parsed = doneEventSchema.safeParse(raw);
		if (parsed.success) handlers.onDone?.(parsed.data);
	} else if (name === 'error') {
		const parsed = errorEventSchema.safeParse(raw);
		if (parsed.success) handlers.onError?.(parsed.data.message);
	}
}

export async function streamAsk(
	args: {
		universeSlug: string;
		question: string;
		detailLevel: AskDetailLevel;
		/** issue #380: oldest first, at most 6 entries - `streamAsk` sends whatever it is
		 * given as-is. The server clamps regardless (`ask/+server.ts`'s own
		 * `parseAskRequestBody`), so this is a courtesy against an oversized request body,
		 * never the enforcement point. */
		history?: AskHistoryTurn[];
		context?: AskContext | null;
	},
	handlers: AskStreamHandlers
): Promise<void> {
	const response = await fetch(`/w/${args.universeSlug}/ask`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			question: args.question,
			detailLevel: args.detailLevel,
			history: args.history,
			context: args.context
		})
	});
	if (!response.ok || !response.body) throw new AskTransportError();
	await consumeAskStream(response.body, handlers);
}

/**
 * The sources a kept record cites, as references rather than as the prose that was
 * rendered from them: the row cites the entry, and the sentence the answer was grounded
 * on. Shared by both surfaces so one of them cannot quietly start sending a shape the
 * endpoint rejects.
 *
 * Issue #535: an indexed source stores `statement`, the sentence, where it used to store
 * `text`, the whole retrieved chunk. A stored citation that is a paragraph is the
 * entry-level pointer this issue replaces, and W3 made the stored form the durable one.
 */
export function keepSourcePayload(sources: readonly AskSource[]): KeepRequestSource[] {
	return sources.map((source) =>
		source.kind === 'own_canon'
			? { kind: 'own_canon', entityId: source.entityId, statement: source.statement }
			: {
					kind: 'indexed',
					dataSourceId: source.dataSourceId,
					pageTitle: source.pageTitle,
					url: source.url,
					statement: source.statement
				}
	);
}

/** Posts `POST /w/<universe>/ask/keep` (#290) and returns the new record's id. Throws on
 * any non-2xx, so a caller shows its own "could not keep that" wording rather than
 * inventing a reason. */
export async function keepAnswer(args: {
	universeSlug: string;
	question: string;
	answer: string;
	detailLevel: AskDetailLevel;
	askedFromPath: string;
	sources: readonly AskSource[];
	/** Issue #437, decision T10, and issue #455, decision U11: which conversation this
	 * turn belongs to. Both callers - the docked panel's own `quickAskState.conversationId`
	 * and the Ask page's own conversation id, minted the moment a fresh conversation's
	 * first question is sent - always supply one now, so every turn asked in one session
	 * groups back together. Left optional on the wire rather than required: the
	 * `keepRequestSchema` field and the column behind it both still default to a fresh
	 * id for whatever future caller has nothing to group against. */
	conversationId?: string;
}): Promise<string> {
	const response = await fetch(`/w/${args.universeSlug}/ask/keep`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			question: args.question,
			answer: args.answer,
			detailLevel: args.detailLevel,
			askedFromPath: args.askedFromPath,
			sources: keepSourcePayload(args.sources),
			conversationId: args.conversationId
		})
	});
	if (!response.ok) throw new Error(`keep failed with ${response.status}`);
	const body: unknown = await response.json();
	const parsed = z.object({ id: z.string() }).safeParse(body);
	if (!parsed.success) throw new Error('keep returned no id');
	return parsed.data.id;
}
