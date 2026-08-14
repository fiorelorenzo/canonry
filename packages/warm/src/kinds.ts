/**
 * SPEC.md §8.1: "Never pre-computed: propagation diffs and Loremaster answers. The
 * criterion is sharp - pre-compute what depends on context, never what depends on
 * input." A propagation diff and a Loremaster answer both depend on something only the
 * GM supplies at the moment of asking (the edit just made, the question just typed); a
 * brief, an NPC draft, an ambient pack, a portrait and a context pack all depend only on
 * canon state that already exists, which is what makes warming them ahead of time safe.
 *
 * The rule is enforced here, not left as a comment on the caller: `WarmArtifactKind`
 * already excludes anything else at the type level (it is `warm_artifact_kind`'s own
 * enum), and `assertWarmable` is the one runtime choke point every candidate-constructing
 * function in this package calls before it will build a `WarmCandidate` - so a value that
 * reaches here only by bypassing the type system (an `any`, a deserialized request body)
 * still gets refused rather than silently warmed.
 */
import { warmArtifactKindEnum, type WarmArtifactKind } from '@canonry/db/schema';

const WARMABLE_KINDS = new Set<string>(warmArtifactKindEnum.enumValues);

export class NotWarmableError extends Error {
	constructor(kind: string) {
		super(
			`"${kind}" cannot be pre-computed: SPEC §8.1 pre-computes what depends on context, ` +
				'never what depends on input (propagation diffs and Loremaster answers are never warmed)'
		);
		this.name = 'NotWarmableError';
	}
}

export function assertWarmable(kind: string): asserts kind is WarmArtifactKind {
	if (!WARMABLE_KINDS.has(kind)) throw new NotWarmableError(kind);
}
