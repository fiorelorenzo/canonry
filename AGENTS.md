# AGENTS.md — building Canonry

Orientation for AI coding agents and human contributors. `SPEC.md` is the source of
truth for **what Canonry is**; the GitHub Project is the source of truth for **where
it stands**. Read the spec fully before implementing anything: it is long because
the product's guarantees live in the details, and most of the traps are written
down there already.

## What Canonry is, in one paragraph

A wiki for a tabletop game world where an AI copilot, the **Loremaster**, works in
every flow and never writes anything the user did not accept. Change one entry and
Canonry says which other entries that touches, drafts each update, and waits. The
rest of the product exists to make that useful at a real table.

## The seven guardrails

These are product constraints, not guidelines. An implementation that violates one
is wrong even if its tests pass, and a PR that erodes one gets rejected on that
basis alone. They are stated in full in `SPEC.md` §3.

1. **Propose, never apply.** Every AI change goes through an explicit accept, per
   entry. No "accept all" default.
2. **AI text is visually distinct** until accepted, and stays tracked afterwards
   (`revision.author_kind`).
3. **Every proposal shows its evidence**: which entry, which sentence. Never a bare
   confidence score.
4. **The AI switches off completely**, and what remains is a good wiki.
5. **Data transparency**: which provider sees campaign content, retention, no
   training on customer data, stated plainly.
6. **Nothing unreviewed is ever published to players.**
7. **Never promise consistency.** The product says "here is what does not add up";
   it never certifies that a canon is coherent. Copy that implies otherwise is a
   defect.

## Stack

SvelteKit 2 with Svelte 5 (runes), Tailwind 4, shadcn-svelte, `adapter-node`.
Postgres 16 for structure, Qdrant for vectors, Better Auth for sessions. AI SDK v7
through **Cloudflare AI Gateway** (`ai-gateway-provider`), Replicate for images
through the same gateway. pnpm monorepo, Node 22.

Packages, as `SPEC.md` §11 lays them out: `apps/web`, `packages/db`,
`packages/vector`, `packages/indexing`, `packages/ai`, `packages/import`.

**One rule about `packages/import` that is easy to break and expensive to fix:** it
exposes `startJob`/`cancel` and nothing outside it knows which driver runs behind
that interface. `GatewayDriver` is the AI SDK loop; `SpoleDriver` will delegate to
Spole. No provider or protocol type may leak past that boundary.

## The UX decisions live in `docs/ux/`

`SPEC.md` says a proposal shows its evidence and never where the evidence sits, and it
is quiet about the interface on purpose. The thirty-eight questions that leaves open
are written down as one HTML artifact each in `docs/ux/`, with the options rendered as
working mock UI on one shared sample world (`docs/ux/SAMPLE-WORLD.md`), what each
option costs, a recommendation and what the choice locks in. Start at
`docs/ux/index.html`, which also carries the inventory of every surface the product
has to grow and the review rubric the guardrails turn into.

Before you build a screen, read the decision that gates it. If it is still open, take
it deliberately and record it in the artifact and in the issue rather than settling it
by accident in a component. If you settle one differently from the recommendation, say
so in the issue, because the next agent will read the artifact and expect it.

## Deployment

Two isolated stacks on prodbox, `preview` and `prod`: separate database, secrets,
subdomain and Qdrant instance. Three containers each (web, Postgres, Qdrant). Tag
`vX.Y.Z` triggers the deploy, which refuses a tag whose CI run is not a completed
success; `releases/<sha>` immutable with a `current` symlink, health gate comparing
the served version against the built artifact, `DEPLOYED.json` as the record of what
is live. Details in `SPEC.md` §12.

## Licence and contributions

AGPL-3.0, and contributions require the CLA in `CLA.md`. Two consequences worth
holding in mind:

- Apache-2.0 code (Spole) can be consumed here; **code from here cannot flow back
  into MIT repositories** such as loombox. Anything meant to be shared between
  projects belongs in Spole, not in Canonry.
- Do not add a dependency whose licence is incompatible with AGPL-3.0
  distribution.

## The GitHub Project is the source of truth

Current state and future roadmap live on **Project #9 "Canonry roadmap"** (owner
`fiorelorenzo`), not in this file, not in the spec, and not in a chat transcript.
`SPEC.md` says what Canonry is, the board says where it stands. Keeping the board
current is part of doing the work, not paperwork at the end: it is how Lorenzo sees
state without reading session logs, so a board that lags reality is worse than no
board.

**Status is a claim about reality, keep it true.**

- Before you write code for an issue, move it to `In Progress`. If what you are
  about to do has no issue, create one first, then start.
- Move it to `Done` only when the change is merged and verified, not when the code
  is written. Merged but something is still open? Say so in a comment and leave it
  `In Progress`.
- Board fields, the same four on every one of Lorenzo's roadmap boards on purpose:
  `Status` (`Todo` / `In Progress` / `Done`), `Priority` (P0-P3), `Effort`
  (S/M/L/XL) and `Parallel` (Yes/No, whether a parallel agent can take the issue
  without colliding). Set all four on anything you file. Never write a value that
  is not already an option, read the schema instead of guessing, and never add,
  rename or drop a field on this board alone: the convention is shared.

**Comment when a reader would want to know.** A decision taken, an approach tried
and abandoned, a blocker hit, a surprise in the code, a finding that invalidates
the issue as written. One comment per meaningful turn in the work, not one per
commit, and no routine progress narration.

**File the work you discover.** When something real surfaces mid-task, open an
issue for it instead of silently widening the current change. Then say in the
current issue that you split it out, with a link.

**Conventions for a new issue.**

- Title follows **conventional-commit form**: `feat(import): ...`, `fix(canon):
  ...`, `test(copilot): ...`. Same scopes as the `area:*` labels.
- Labels: exactly one `type:*` (`feature`, `fix`, `refactor`, `test`, `chore`,
  `ci`, `docs`, `design`, `security`, `spike`), exactly one of
  `priority:P0`-`priority:P3`, and one or more `area:*`. `epic` and `flagship` are
  the only unprefixed labels. Priority is deliberately in two places, the board
  field and the label, so set both.
- `area:*` values here: `canon`, `copilot`, `import`, `index`, `media`, `table`,
  `players`, `web`, `billing`, `deploy`, `docs`. Add one only when the surface
  really is new.
- Milestone: `v0` (the engine), `v1` (the sellable product), `v2` (distribution).
- **Every issue hangs off an epic.** Epics are titled `[Epic] Name` and carry the
  `epic` label. If none of the thirteen fits, create a new one and parent the issue
  to it. An issue with no parent is a defect in the board.

```bash
# Read the schema, never guess an option value
gh project field-list 9 --owner fiorelorenzo --format json
gh label list -R fiorelorenzo/canonry --limit 100

# Fill these three in; everything below runs as written, no placeholders to edit
ISSUE=123                 # the issue you are working on
EPIC=1                    # its parent epic
STATUS="In Progress"      # Todo | In Progress | Done

PROJECT_ID=$(gh project view 9 --owner fiorelorenzo --format json --jq '.id')
STATUS_FIELD=$(gh project field-list 9 --owner fiorelorenzo --format json \
  --jq '.fields[] | select(.name=="Status") | .id')
OPTION_ID=$(gh project field-list 9 --owner fiorelorenzo --format json \
  --jq ".fields[] | select(.name==\"Status\") | .options[] | select(.name==\"$STATUS\") | .id")
ITEM_ID=$(gh project item-list 9 --owner fiorelorenzo --format json --limit 500 \
  --jq ".items[] | select(.content.number==$ISSUE) | .id")
gh project item-edit --id "$ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$STATUS_FIELD" --single-select-option-id "$OPTION_ID"

# New issue: create it, put it on the board, hang it off its epic
ISSUE_URL=$(gh issue create -R fiorelorenzo/canonry --title "feat(canon): ..." \
  --body "..." --milestone "v0" --label "type:feature,priority:P1,area:canon")
gh project item-add 9 --owner fiorelorenzo --url "$ISSUE_URL"
gh api graphql -f query='mutation($p:ID!,$c:ID!){addSubIssue(input:{issueId:$p,subIssueId:$c}){subIssue{number}}}' \
  -f p="$(gh issue view $EPIC -R fiorelorenzo/canonry --json id --jq '.id')" \
  -f c="$(gh issue view "$ISSUE_URL" --json id --jq '.id')"
```

`item-edit` is idempotent, so re-setting a value that is already correct is a fine
way to make sure the board is right. An issue can have only one parent: to move it,
pass `replaceParent: true` in the same mutation.

## Two metrics decide whether this product works

Instrument them from the first commit that touches their subject, because neither
can be reconstructed later:

- **Accept rate of propagation proposals.** Below a threshold the copilot is noise,
  and that matters more than the number of entries created.
- **Time from import to first accepted proposal.** The product loses to Obsidian if
  first value takes an hour.

`SPEC.md` §14 lists the rest, including the two harnesses (a corpus of test worlds
with expected propagations, and the matching benchmark of §6.4) that have to exist
early to mean anything.

## Writing style for anything repo-facing

Issues, PRs, commits, comments and reviews are written in first person as Lorenzo,
in English, in plain prose. No em dashes, no "not just X but Y", no puffery, no
emoji. Follow Conventional Commits for commit messages. Be specific: name the file,
the symbol, the observable behaviour.
