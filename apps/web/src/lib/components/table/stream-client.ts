/**
 * Issue #79's client half: a thin `EventSource` wrapper. The ordering and reconnect
 * guarantee is entirely the browser's own `EventSource` behaviour plus the server's `id:`
 * lines (`$lib/server/table-stream.ts`) - this module adds nothing but typed dispatch and a
 * place to log what arrived, in order, for #79's own acceptance ("quote the SSE event order
 * across a reconnect").
 */

export interface TableStreamMessage {
	id: number;
	type: string;
	data: unknown;
}

export interface TableStreamHandle {
	close: () => void;
	/** Every message this connection has received, oldest first - the log #79's acceptance
	 * asks to quote. Survives a reconnect: `EventSource` resumes the same object, it does
	 * not get replaced. */
	log: TableStreamMessage[];
}

const EVENT_TYPES = ['context', 'quick-action', 'proposal', 'reveal', 'session-ended'] as const;

export function connectTableStream(
	universeSlug: string,
	onMessage: (message: TableStreamMessage) => void
): TableStreamHandle {
	const log: TableStreamMessage[] = [];
	const source = new EventSource(`/u/${universeSlug}/table/stream`);

	for (const type of EVENT_TYPES) {
		source.addEventListener(type, (event: MessageEvent<string>) => {
			const message: TableStreamMessage = {
				id: Number(event.lastEventId),
				type,
				data: JSON.parse(event.data) as unknown
			};
			log.push(message);
			onMessage(message);
		});
	}

	return {
		close: () => source.close(),
		log
	};
}
