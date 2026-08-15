/**
 * Issue #79: SSE to the client with ordering guaranteed, surviving a reconnect without
 * replaying material the client already has. Standard `EventSource` semantics do the work:
 * every event carries an `id:` line, the browser remembers the last one it saw, and sends
 * it back as `Last-Event-ID` on reconnect - `subscribeTableStream` (table-stream.ts) is
 * what turns that header into "replay only what came after this id".
 */
import { subscribeTableStream, type TableStreamEvent } from '$lib/server/table-stream';
import { requireTableAccess } from '../_server/guard.js';
import type { RequestHandler } from './$types';

const KEEPALIVE_MS = 20_000;

function frame(event: TableStreamEvent): string {
	return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

export const GET: RequestHandler = async (event) => {
	const access = await requireTableAccess(event);

	const lastEventIdHeader = event.request.headers.get('last-event-id');
	const sinceId = lastEventIdHeader !== null ? Number.parseInt(lastEventIdHeader, 10) : null;

	let keepalive: NodeJS.Timeout;
	let unsubscribe: (() => void) | undefined;
	// The platform can tear this stream down two independent ways - the request's
	// `AbortSignal` fires (client disconnected) and/or the `ReadableStream` itself calls
	// `cancel()` (consumer stopped reading) - and both can also race a `send()` already in
	// flight from a just-published event. Any of the three touching an already-closed
	// controller throws `ERR_INVALID_STATE`, and because that throw happens inside an
	// `AbortSignal` event listener, Node rethrows it on `process.nextTick` past every
	// try/catch here and crashes the whole process, not just this one request. `closed`
	// makes every teardown path idempotent so `controller.close()` is called at most once
	// and `enqueue` never runs after it.
	let closed = false;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			const send = (chunk: string) => {
				if (closed) return;
				controller.enqueue(encoder.encode(chunk));
			};

			send('retry: 2000\n\n');

			const subscription = subscribeTableStream(access.universe.id, sinceId, (streamEvent) => {
				send(frame(streamEvent));
			});
			unsubscribe = subscription.unsubscribe;
			for (const backlogged of subscription.backlog) send(frame(backlogged));

			// Caddy and most proxies drop an idle connection well under a minute; a comment
			// line is invisible to EventSource's own event parsing and keeps the socket open
			// for a session that can run hours.
			keepalive = setInterval(() => send(': keepalive\n\n'), KEEPALIVE_MS);

			const closeOnce = () => {
				if (closed) return;
				closed = true;
				clearInterval(keepalive);
				unsubscribe?.();
				try {
					controller.close();
				} catch {
					// The consumer side (cancel()) may have already closed it first - both
					// paths converging here is expected, not an error worth surfacing.
				}
			};
			event.request.signal.addEventListener('abort', closeOnce);
		},
		cancel() {
			closed = true;
			clearInterval(keepalive);
			unsubscribe?.();
		}
	});
	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
};
