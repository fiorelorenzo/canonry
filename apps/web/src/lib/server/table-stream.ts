/**
 * Issue #79, SPEC.md §11.1: "events produced in parallel reach the client in order,
 * without buffering." This is what makes E2's progressive arrival (decision, docs/ux
 * e2-lane-latency.html) read as "alive" instead of "random" - its own lock-in note names
 * this file directly: "cards must arrive and update in the order they were requested, or
 * 'progressive' reads as random."
 *
 * One append-only, monotonically-numbered event log per universe's table session, kept in
 * this process's memory. SPEC.md §12 runs one web container per stack, so there is no
 * cross-process fan-out to solve here; a durable cross-restart log would be a real feature
 * for a horizontally-scaled deployment this product does not have. A reconnecting
 * `EventSource` sends the last `id` it saw back via the standard `Last-Event-ID` header
 * (browsers do this on their own, no client code required); `subscribeTableStream` replays
 * only what came after that id, so a dropped wifi connection never re-delivers material the
 * client already rendered. A fresh connection (no header at all) replays the whole current
 * backlog instead of starting silent, because "already has" is the empty set for a tab that
 * has never connected before, and late-arriving warm material from before the tab opened
 * should still show up once.
 *
 * The backlog is bounded (`BACKLOG_LIMIT`), not a durable log: long enough to survive a
 * normal reconnect, not a promise to replay a session from hours ago.
 */

export type TableStreamEventType =
	'context' | 'quick-action' | 'proposal' | 'reveal' | 'session-ended';

export interface TableStreamEvent {
	id: number;
	type: TableStreamEventType;
	data: unknown;
	at: string;
}

const BACKLOG_LIMIT = 300;

class TableEventBus {
	private nextId = 1;
	private readonly backlog: TableStreamEvent[] = [];
	private readonly listeners = new Set<(event: TableStreamEvent) => void>();

	publish(type: TableStreamEventType, data: unknown): TableStreamEvent {
		const event: TableStreamEvent = {
			id: this.nextId,
			type,
			data,
			at: new Date().toISOString()
		};
		this.nextId += 1;
		this.backlog.push(event);
		if (this.backlog.length > BACKLOG_LIMIT) this.backlog.shift();
		for (const listener of this.listeners) listener(event);
		return event;
	}

	/** Strictly after `sinceId` - `0` (the default for a fresh connection) returns the whole
	 * buffered backlog, since id numbering starts at 1. */
	backlogSince(sinceId: number): TableStreamEvent[] {
		return this.backlog.filter((event) => event.id > sinceId);
	}

	subscribe(listener: (event: TableStreamEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}

const buses = new Map<string, TableEventBus>();

function busFor(universeId: string): TableEventBus {
	let bus = buses.get(universeId);
	if (!bus) {
		bus = new TableEventBus();
		buses.set(universeId, bus);
	}
	return bus;
}

/** Every table-mode server route that changes something the client should see (context
 * declared, a quick action fired, a proposal landed, a note captured) calls this instead of
 * relying on the next page load - that is the whole point of the stream existing. */
export function publishTableEvent(
	universeId: string,
	type: TableStreamEventType,
	data: unknown
): TableStreamEvent {
	return busFor(universeId).publish(type, data);
}

export interface TableStreamSubscription {
	/** Whatever the client missed (or, on a fresh connection, everything currently
	 * buffered) - sent before the live feed starts so ordering never depends on the race
	 * between "read the backlog" and "a new event arrives". */
	backlog: TableStreamEvent[];
	unsubscribe: () => void;
}

export function subscribeTableStream(
	universeId: string,
	sinceId: number | null,
	onEvent: (event: TableStreamEvent) => void
): TableStreamSubscription {
	const bus = busFor(universeId);
	// Read the backlog and register the live listener as one synchronous step so no event
	// published between the two calls could be both missed by the backlog read and missed
	// by a listener that was not registered yet.
	const backlog = bus.backlogSince(sinceId ?? 0);
	const unsubscribe = bus.subscribe(onEvent);
	return { backlog, unsubscribe };
}
