/**
 * Issue #699: how `POST /w/<universe>/ask/keep` learns what the turn it is about to store
 * could not finish, without being told by the client.
 *
 * The two facts (#696's `AskResult.loss`) are known only inside the SSE stream, and the
 * keep is a second request that arrives a moment later carrying whatever the browser has
 * in front of it. Every other field in that body is content the GM can already see and
 * edit nothing about; this one is a claim about the answer's own completeness, and a client
 * that can say "not truncated" is a client that can launder a bad answer past the notice
 * #696 added. So it is resolved here, the same way the guardrail 5 provider fields in
 * `keep/+server.ts` are resolved rather than accepted: `ask/+server.ts` files the turn's
 * loss under an opaque id as the stream ends, sends only that id on the `done` event, and
 * the keep endpoint redeems it. The body carries the id and never the verdict.
 *
 * Process-local, like `$lib/server/table-stream.ts` and for the same reason it states:
 * SPEC.md §12 runs one web container per stack, so there is no cross-process handoff to
 * solve. The failure mode when an entry is missing anyway - a restart between the answer
 * and the keep, a TTL expiry, a browser that sat on the tab for an hour - is not a wrong
 * record but no record: `keepAnswer` writes both columns null, which is exactly what those
 * columns' nullability means (#699: "we do not know", never "it finished"). That is the
 * whole reason this can be memory rather than a table.
 *
 * Three properties it does have to hold, because each of them is a way to get a false
 * record rather than a missing one:
 *
 * - **Scoped to the account that asked.** Redeeming takes the user id and compares it, so
 *   one account cannot spend another's turn and attach its loss to their own answer.
 * - **Single use.** An id is deleted the moment it is redeemed, so one truncated turn
 *   cannot mark a second kept answer.
 * - **Bounded.** A TTL plus a hard entry cap, since nothing guarantees a keep ever arrives:
 *   a GM who closes the tab mid-answer leaves an entry nobody will ever redeem.
 */
import { randomUUID } from 'node:crypto';

/** Resolved rather than optional: `runAsk` reports `null` for a turn that finished, and
 * this records that as a claim (`false`/`0`) rather than as an absence, because the record
 * has to be able to say "nothing was lost" as well as "something was" (guardrail 7). */
export interface TurnLoss {
	truncated: boolean;
	lostProposals: number;
}

interface Entry {
	userId: string;
	loss: TurnLoss;
	at: number;
}

/** Generous next to the seconds a keep actually takes (`$lib/ask/stream.ts` posts it as
 * soon as the stream closes), and short enough that a tab left open all afternoon does not
 * keep a claim about a turn alive long past the point anyone would recognise it. */
const TTL_MS = 10 * 60 * 1000;

/** A ceiling on the whole map rather than per account, because the thing being bounded is
 * this process's memory. Well above any plausible number of Ask turns in flight at once on
 * one container, and small enough that the eviction below can never be the reason a real
 * keep loses its entry in practice. */
const MAX_ENTRIES = 500;

const entries = new Map<string, Entry>();

function sweep(now: number): void {
	for (const [id, entry] of entries) {
		if (now - entry.at > TTL_MS) entries.delete(id);
	}
	// Insertion order is age order, so the oldest survivors go first when a burst of turns
	// nobody redeemed pushes the map over the cap anyway.
	while (entries.size > MAX_ENTRIES) {
		const oldest = entries.keys().next();
		if (oldest.done === true) break;
		entries.delete(oldest.value);
	}
}

/**
 * Files one finished turn's loss and returns the id the `done` event carries. `null` in
 * means the turn finished, which is recorded as `false`/`0` rather than as nothing: the
 * over-claiming half of guardrail 7 is a record that says a turn was cut off when it was
 * not, and the under-claiming half is a record that cannot tell "finished" from "unknown".
 */
export function recordTurnLoss(userId: string, loss: TurnLoss | null): string {
	const now = Date.now();
	sweep(now);
	const id = randomUUID();
	entries.set(id, {
		userId,
		loss: loss ?? { truncated: false, lostProposals: 0 },
		at: now
	});
	return id;
}

/**
 * Redeems an id, once, for the account that owns it. `null` for an id this process never
 * issued, one already spent, one past its TTL, and one belonging to somebody else - all
 * four are "we do not know", and the caller writes both columns null rather than guessing
 * at the friendlier answer.
 */
export function takeTurnLoss(userId: string, id: string | undefined): TurnLoss | null {
	if (id === undefined) return null;
	sweep(Date.now());
	const entry = entries.get(id);
	if (!entry) return null;
	// Deleted whether or not it matched: an id offered by the wrong account is spent, not
	// left lying around to be offered again.
	entries.delete(id);
	return entry.userId === userId ? entry.loss : null;
}

/** Test-only reset, so one file's entries cannot outlive it into another's assertions. */
export function _clearTurnLosses(): void {
	entries.clear();
}
