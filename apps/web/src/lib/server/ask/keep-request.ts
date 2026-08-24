/**
 * Issue #290: the request body `POST /w/<universe>/ask/keep` accepts, kept in its own module
 * because it is a contract another surface builds against rather than an implementation
 * detail of one endpoint. #285's floating composer posts this shape, and the endpoint's own
 * tests exercise it here without needing a request.
 *
 * What is deliberately absent from the body is as much of the contract as what is in it: the
 * universe, the account, the locale and the provider are all resolved server-side. A
 * guardrail 5 disclosure the caller could set would not be a disclosure.
 */
import { z } from 'zod';

export const keepSourceSchema = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('own_canon'),
		entityId: z.string().uuid(),
		/** The sentence the answer was grounded on, which the record snapshots. */
		statement: z.string().trim().min(1)
	}),
	z.object({
		kind: z.literal('indexed'),
		/** Null for a retrieved page whose corpus row the client does not know; the citation
		 * still carries the page's own title and URL, which is what SPEC.md §7 needs beside it. */
		dataSourceId: z.string().uuid().nullable().default(null),
		pageTitle: z.string().trim().min(1),
		url: z.string().url(),
		statement: z.string().trim().min(1)
	})
]);

/** 24 is well above `runAsk`'s own `OWN_CANON_LIMIT` of 6 plus its indexed layer, and exists
 * so a malformed or hostile caller cannot make one kept answer carry thousands of rows. */
const MAX_SOURCES = 24;

export const keepRequestSchema = z.object({
	question: z.string().trim().min(1),
	answer: z.string().trim().min(1),
	detailLevel: z.enum(['1_line', 'short', 'normal', 'detailed', 'full']),
	/** The page the question was asked from, as a path inside this app. Rejected here and
	 * again by `kept_answer_asked_from_path_relative` in the database, because a stored
	 * absolute URL would turn the history's own "asked from" into an off-site link. */
	askedFromPath: z
		.string()
		.startsWith('/')
		.refine((value) => !value.startsWith('//'), 'a path, not a protocol-relative URL'),
	sources: z.array(keepSourceSchema).max(MAX_SOURCES).default([]),
	/** Issue #437, decision T10, widened by issue #455, decision U11: which conversation
	 * this turn belongs to. Every caller sends one today - the docked panel's own
	 * `quickAskState.conversationId`, and the Ask page's own, minted the moment a fresh
	 * conversation's first question is sent - but stays optional on the wire so the
	 * database column's own `defaultRandom()` still has a caller to serve. */
	conversationId: z.string().uuid().optional(),
	/** Issue #699: the handle `ask/+server.ts` minted for this turn, redeemed server-side for
	 * what the turn could not finish. The two facts themselves are deliberately absent from
	 * this schema, and that absence is the point: a client that can claim an answer was not
	 * truncated is a client that can launder a bad answer past the notice #696 added, exactly
	 * as a client-set `provider` would not be a guardrail 5 disclosure. Optional, because an
	 * unredeemable turn has to produce a record that says "we do not know" rather than a
	 * rejected keep that loses the answer as well. */
	turnId: z.string().uuid().optional()
});

export type KeepRequest = z.infer<typeof keepRequestSchema>;
export type KeepRequestSource = z.infer<typeof keepSourceSchema>;
