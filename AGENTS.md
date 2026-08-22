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

1. **Propose, never apply.** Every AI-authored change to canon content goes through an
   explicit accept, per entry. One named exception, and no other: a field a re-import
   writes because the source changed and the user never touched it (`SPEC.md` §6.4)
   carries no proposal, because the merge engine and not a model made that write. No
   "accept all" default beyond that, not behind a dialog, never for content the GM has
   not read.
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
through **Vercel AI Gateway** (`@ai-sdk/gateway`) for text and embeddings, with
Replicate (images) and ElevenLabs (sound) called directly, because the gateway routes
neither. pnpm monorepo, Node 22.

Packages, as `SPEC.md` §11 lays them out: `apps/web`, `packages/db`,
`packages/vector`, `packages/indexing`, `packages/ai`, `packages/import`.

**One rule about `packages/import` that is easy to break and expensive to fix:** it
exposes `startJob`/`cancel` and nothing outside it knows which driver runs behind
that interface. `GatewayDriver` is the AI SDK loop; `SpoleDriver` will delegate to
Spole. No provider or protocol type may leak past that boundary.

**Which model runs which purpose is measured, not chosen.** `docs/models.md` records the
decision for `cheap`, `premium`, `multimodal` and `embedding`, with the numbers behind each
one and the cost of the alternative that was not taken. `packages/bench` is the harness that
produced it: it runs the product's own functions with a candidate swapped into
`model_config`, against a real gateway, a real Postgres and a real Qdrant, over a corpus of
the sample world rendered into every import format. It also carries the end-to-end runs for
import and the Loremaster. Do not change a `model_config` row without re-running it, and do
not add a provider to `KNOWN_PROVIDERS` without a measurement to point at.

## Working in a worktree, next to other agents

**The dev services are shared, and safe to share.** `pnpm db:up` starts Postgres on
`127.0.0.1:55432` and Qdrant on `127.0.0.1:56333` from `docker/compose.dev.yml`, once for
the machine: every worktree talks to those same two, because isolation happens inside them
rather than at the service level. The web app runs on the host, so restarting it never
touches a container.

**Test state is isolated per run, by a suffix.** `packages/{db,ai,import,vector,indexing,media}`
set `TEST_DB_SUFFIX=$$` in their `test` script, and `packages/db/test/env.ts` turns that into
`canonry_test_<suffix>`. The suffix is load-bearing: the global setup drops the database,
recreates it, and terminates every other backend connected to it, so two runs sharing a
suffix kill each other mid-query, which reads like a `postgres.js` bug and is not one. The
default is `local`, so two `vitest` runs started by hand in two worktrees do collide unless
you set it. **`apps/web` does not set it for you, so pass it yourself**
(`TEST_DB_SUFFIX=w<issue> pnpm --filter web test`) whenever anything else is running: with no
suffix and no `TEST_DATABASE_URL` that suite runs against the **dev** database, migrated in
place rather than dropped, which is deliberate and also means an unsuffixed run writes where a
running dev server reads. `packages/bench` and `packages/eval` need none of this: neither has a
test that touches Postgres. CI sets `TEST_DATABASE_URL` explicitly and keeps one deterministic
name, and that variable still wins everywhere when it is set. Qdrant needs nothing: each vector
test creates a scratch collection under a fresh UUID and drops it afterwards.

That last part was wrong in this file for a day, and the way it was wrong is worth keeping:
`apps/web` read only `TEST_DATABASE_URL` and `DATABASE_URL`, so the documented
`TEST_DB_SUFFIX=w<issue>` prefix was a silent no-op there and nine agents in one wave all
wrote to the dev database believing they were isolated. A convention a package ignores without
saying so is worse than no convention, which is why the app now reads the suffix too.

**And passing the suffix to those six packages is a no-op, which is fine but confusing.** A
package whose own script reads `TEST_DB_SUFFIX=$$ vitest run` reassigns the variable inside the
command, and an inline assignment beats an inherited one: `A=x sh -c 'A=y; echo $A'` prints
`y`. So `TEST_DB_SUFFIX=w<issue> pnpm --filter @canonry/db test` runs under the shell's PID
rather than under `w<issue>`, which is still a unique per-run database and therefore still
isolated. Nothing is broken; what is broken is looking for `canonry_test_w<issue>` afterwards
and not finding it. `npx vitest run` from inside the package honours an external suffix if you
actually need a named database to inspect. `apps/web` is the one that needs the prefix, because
its script does not set one.

**Nothing drops the suffix database afterwards, so a janitor does.** The global setup
drops and recreates the database it is about to use, but on purpose never drops it when
the run ends, because a failed run's database is the debugging the suffix convention
exists to enable. Left alone that means every test run in every worktree leaves a
`canonry_test_<suffix>` database behind forever, which by 2026-08-19 was 920 of them on
the shared dev Postgres. `scripts/test-db-janitor.sh` cleans that up on a schedule
instead: it drops a `canonry_test_*` database only once it has no live connection and its
data directory (`/var/lib/postgresql/data/base/<oid>` inside the container, the mtime of
which moves on every write and is the closest thing Postgres has to a per-database "last
used" signal) has not been written to in 3 days by default (`--days N` to change it,
`--dry-run` to preview). The `canonry_test_` prefix is the only thing it will ever touch:
`canonry`, `canonry_demo` and the rest of the hand-named databases in the section above,
plus every `canonry_w<issue>_demo` a worktree is using, do not match it and are never
candidates, not by a live-connection check but structurally. It runs from a cron entry
for the `dev` user on this box (`crontab -l -u dev`), once a day; nothing about it runs
in CI or touches a worktree's own database.

**The suffix is per run, not per file, and that is a second race.** Vitest's fork pool runs
a package's test files concurrently against that one database, so two files that drive the
same table through delete-all-then-insert clobber each other's rows, and the failure surfaces
as a flake in whichever file read last rather than as a collision. That is what #193 turned
out to be: `models.test.ts` and `generate.test.ts` both owning `image_model_config`, one
failure in 9365 iterations under deliberate load. The in-repo answer is a session-scoped
advisory lock the files take in `beforeAll` and release in `afterAll`
(`lockImageModelConfigForFile` in `packages/media/src/test-db.ts`, and the same shape already
existed for `model_config` in the audio tests), which works because each file's `Db` holds a
single connection for its whole run. A new test file that writes a table another file already
owns takes the same lock or inherits the same flake.

**`.env` is the compose stack's environment, not the test suite's.** Its `DATABASE_URL` and
`QDRANT_URL` name the compose services (`postgres:5432`, `qdrant:6333`), which is correct
inside that network and wrong from the host, so the tests bypass it and default to loopback.
A fresh worktree therefore needs no `.env` to run `pnpm lint`, `pnpm check` or `pnpm test`;
it needs the dev services up. It needs the opposite discipline instead: a leftover exported
`DATABASE_URL` or `TEST_DATABASE_URL` outranks those defaults, so clear it rather than trust
the file.

**Regenerate the playbooks, or CI will.** `packages/import/src/playbooks.generated.ts` is
committed because the Docker image builds `apps/web` directly and never runs that package's
build. Its own `build`, `check` and `test` scripts regenerate it first, and CI runs the
generator and then `git diff --exit-code` on it, so an edited `playbooks/*.md` with a stale
generated file is a red PR by itself.

**Scoping a check.** The root scripts are `pnpm -r --sequential`, so they cover every
package; scope with `pnpm --filter @canonry/<pkg> <script>`, because `pnpm test -- <path>`
does not scope (the root has no vitest config). `check` is `tsc` and `svelte-check`, which
read the whole graph and are whole-project by nature. A package whose tests need Postgres
pays the drop-create-migrate cost even for one test file. CI runs lint, typecheck, tests and
build, plus a docker-boot job that builds the image and requests every major surface:
nothing local reproduces that job, so do not report it as verified.

**The root `typescript` is 6.x on purpose, and it is what makes `lsp` work at all.** The
eleven `packages/*` that typecheck are on `^7.0.2`, the native port, and stay there: that is
what `pnpm check` runs, and each package's `node_modules/.bin/tsc` resolves its own copy, so
the root version reaches none of them. What the root version does reach is
`node_modules/typescript/lib`, which is the one place `typescript-language-server` looks for a
`tsserver.js` before it gives up. TypeScript 7 ships no `tsserver.js` at all, so with `^7.0.2`
at the root every LSP consumer in this repo got "Could not find a valid TypeScript
installation" and no references, no rename and no definition, which is how #570 ended up
deleting an exported field with grep as its only evidence. `^6.0.3` at the root, matching
`apps/web`, fixes that for any client with no configuration file to know about. So do not
"align" the root with the packages: that reintroduces #585, and it fails silently, since an
agent that gets no server just falls back to grep.

**One migration per wave.** `pnpm --filter @canonry/db generate` numbers the next migration
sequentially and also writes `migrations/meta/_journal.json` and a snapshot. Two agents
generating at the same time produce the same number and both edit the journal, and no rebase
resolves that: the second waits for the first to land, then regenerates instead of
renumbering by hand.

**A migration number is only as good as the branch's base, and `baseBranch: main` can lie.**
A worktree cut with Paseo's `create_workspace` branches off the source checkout's **local**
`main` ref, not `origin/main`, so a checkout nobody fast-forwarded hands every worktree a
stale base. On 2026-08-19 that put nine branches on a commit eleven behind, and the agent on
#290 read `packages/db/migrations` honestly, saw 0038 as the highest, and generated a 0039
that already existed on `main` as #284's. The number was wrong before a line of its migration
was written. `git fetch && git merge --ff-only origin/main` in the source checkout before
cutting a wave, and in the worktree check `git merge-base --is-ancestor origin/main HEAD`
rather than trusting the base you were given.

**Two PRs green apart can be red together, and only the merge commit says so.** With
`strict_required_status_checks_policy` false, which is deliberate because forcing eight open
PRs to rebase on every merge is real friction, nothing runs CI on the combination until it is
`main`. That happened twice in one wave: #312 renamed an export while #320 was adding a test
that imported the old name, and #314 removed two i18n keys while #319 was adding a component
that called them. Six PRs merged green and `main` had three typecheck errors, fixed in #324.
Do not turn strict on; instead, after the last merge of a wave, check the run on the merge
commit rather than on any branch, and treat a rename or an i18n key removal as a conflict
magnet even when git reports no conflict, because the collision is by name and not by line.

**Nothing guards `main`, but only one merge method is allowed.** There is no branch
protection and no ruleset, so a red PR can be merged and the gate is you. What is not open
is how: `allow_squash_merge` is the only one true, and both `allow_merge_commit` and
`allow_rebase_merge` are false, so `gh pr merge --rebase` and `--merge` are refused with
"Rebase merges are not allowed on this repository" and every commit on `main` is a squash
carrying its PR number. Write the PR body as the durable record, because a wave's individual
commit messages do not survive the merge. `delete_branch_on_merge` is on, so the remote
branch goes away by itself and `--delete-branch` is unnecessary rather than required. This
paragraph said the opposite of all of that until 2026-08-19, three methods enabled and
`delete_branch_on_merge` off, so read the repo rather than this file when it matters:

```bash
gh api repos/fiorelorenzo/canonry \
  --jq '{squash: .allow_squash_merge, merge: .allow_merge_commit, rebase: .allow_rebase_merge, delete: .delete_branch_on_merge}'
```

A green CI run on `main` deploys preview through `deploy.yml`, so whatever lands there
reaches a real stack a few minutes later. Merging a wave one PR at a time queues one preview
deploy per merge, and `deploy.yml`'s concurrency group cancels the superseded ones, which is
expected rather than a failure to chase.

**`git stash` is shared between worktrees, and it will swap two agents' work.** This is the
worst collision found so far because nothing about it looks like a collision: `refs/stash`
lives in the one `.git` directory every worktree of this repo shares, so it is a single stack
rather than one per tree. On 2026-08-20 two agents ran `git stash push` seconds apart to take
a before/after measurement, and each `pop` returned the other's diff: #412's two files landed
applied in #409's worktree and #409's four in #412's. Both noticed only because `git status`
listed files they had never touched. **Never `git stash` in a worktree while a wave is
running.** For a before/after, `git diff > /tmp/mine.patch`, then `git checkout -- <files>`,
then `git apply` to come back: purely local, no shared ref. `git show HEAD:<path>` reads the
old version without touching the tree at all, and https://preview.canonry.io is `main` a few
minutes old when what you need is a rendered baseline. If a pop has already gone wrong, the
lost entry is usually still a dangling commit: `git fsck --unreachable` and look for `WIP on
w<issue>`.

**And the worse version of the same lesson: `git reset --hard` in a worktree somebody else is
also in.** On 2026-08-22 round eighteen's #529 had two writers for most of the wave, and twice
while I was repairing the branch a `reset --hard HEAD` plus a `git merge origin/main` ran inside
that tree and threw away uncommitted repairs of mine, once silently enough that I only found out
by re-running `check` and seeing a property I had deleted come back. The reflog was the only
record: `reset: moving to HEAD` is what it looks like, and it names no author. The agent that
owned the issue denied both and its account was consistent with what it had actually run, a
scoped three-file `git checkout --`, so the honest conclusion is that a shared tree has no
attribution at all. Two rules come out of it. **Nothing uncommitted may live in a worktree while
another writer might be in it**: commit early, even a `wip` commit you amend, because a commit is
the only thing `reset --hard` cannot silently eat. And **when a tree turns out to have two
writers, take the work out of it** rather than negotiating turns: `git worktree add` a fresh one
from the pushed branch and finish there, which is what actually ended that incident after two
lost rounds of repair.

**Two more things collide between worktrees that are not the database.** The first is your own file
tools: a relative path resolves against the session's working directory, not the worktree, and
in the first parallel wave three agents wrote part of their change into the main checkout that
way. It happened again in round thirteen's two waves and again in round fourteen's, to five
more agents across the three, and every one of them caught it themselves within a few edits,
so treat it as the default failure rather than an unlucky one: absolute paths under your own
worktree for every read and edit, and check `git status --short` in your own tree after a
write when you are not sure. When it happens, say so immediately rather than reverting
somebody else's uncommitted work by reflex: on 2026-08-20 #408's whole change was sitting in
the main checkout, and the fix was one `git diff > /tmp/patch` there and one `git apply` in
the worktree, with nothing retyped. The symptom to recognise is an edit tool reporting success
while `git diff` in your worktree shows nothing: the write landed, in the other tree. And the
mechanism is not always a hand-typed relative path: twice in round sixteen it was an agent
copying `read`'s own abbreviated display header, `~/projects/personal/canonry-wNNN/...`, into an
edit header, where the tilde is not expanded and the rest reads as relative. Retype the real
absolute path rather than copying what a read printed back at you.
The orchestrator's half of that lesson is sharper: **never `git add -A` in the main checkout
while a wave is running.** On 2026-08-20 that swept three of #385's stray files into #399's
commit, and the fix was a `reset --soft`, a `restore` of the four files and a force-push on a
PR that had already been opened.

The second is the dev server: pick a port per worktree and announce it, because `vite` will
happily take the next free one and then you are reading a sibling's app. A signed-in browser
check used to be the thing that could not be parallelised at all, because cookies are scoped
by host and path and ignore the port (RFC 6265), so every dev server on `localhost` shares one
session and whoever signed in last wins. **Give each worktree its own loopback address and the
problem goes away**: `127.0.0.11`, `127.0.0.12` and so on are different hosts to the cookie
jar, they all exist on this box with no setup, and eight agents held eight independent
sessions at once through them in round thirteen. `--host 127.0.0.N --port 52NN --strictPort`,
and note that vite prints `Network:` rather than `Local:` for a non-loopback-default host, so
a readiness pattern matching `Local:` waits forever.

The signed-in recipe itself, which every agent otherwise re-derives: create a
`canonry_w<issue>_demo` database, migrate and seed it, start the dev server against it, create
the account through the app's own `POST /api/auth/sign-up/email`, grant it `owner` on the
seeded universes with one `INSERT INTO universe_member ... ON CONFLICT DO UPDATE`, then read
the `better-auth.session_token` cookie out of `curl -c -` and hand it to `uishot --cookie`.
`scripts/demo-reset.sh` is the same thing for the shared `canonry_demo`, and its ordering trap
is worth knowing: it drops the database the app is holding a pool on, so the app exits and the
script then waits for it to come back.

**Formatting is a CI gate, and `pnpm check` does not stand in for `pnpm build`.** Two ways a
PR goes red after a clean `check`. The Lint job is `prettier --check .` plus `eslint .` per
package, so one unformatted file you touched is a red run on its own: run
`pnpm --filter <pkg> lint` before committing and fix with `npx prettier --write` on your own
files only, from inside `apps/web` for a Svelte file, since the plugin resolves from the
package rather than the root. And SvelteKit allows only its own named exports from
`+server.ts` and `+page.server.ts` (`GET`, `POST`, `load`, `actions`, and anything prefixed
`_`); `tsc` and `svelte-check` are happy with a helper exported for a test, and the build
fails. Two agents in round thirteen shipped that same red build within an hour of each other,
one from `ask/+server.ts` and one from the settings page's own `+page.server.ts`, where the
symptom was a 500 in the dev server rather than a type error. Run `pnpm --filter web build`
once before pushing anything that touches either kind of file.

**`eslint .` over `apps/web` takes minutes under a wide wave.** Eight worktrees linting the
same graph at once pushed one run past seven minutes and another past a 300s tool timeout,
which reads like a hang and is contention. Scope eslint to your own files while you work and
let CI run the package.

**The board's own API is a shared quota.** Projects v2 fields are GraphQL-only, and GraphQL is
5000 points an hour **per account**, not per repo. Setting four fields on thirteen issues plus
`gh pr create` (also GraphQL) exhausted it in one wave and every later call failed with "API
rate limit already exceeded" while REST still had its full 5000. `gh api repos/<owner>/<repo>/pulls`
opens a PR over REST when that happens, and `gh api rate_limit` says which budget is gone.

## The UX decisions live in `docs/ux/`

`SPEC.md` says a proposal shows its evidence and never where the evidence sits, and it
is quiet about the interface on purpose. The questions that leaves open are written
down as one HTML artifact each in `docs/ux/`, with the options rendered as working mock
UI on one shared sample world (`docs/ux/SAMPLE-WORLD.md`), what each option costs, a
recommendation and what the choice locks in. Start at `docs/ux/index.html`, which also
carries the inventory of every surface the product has to grow and the review rubric
the guardrails turn into.

**`docs/ux/DECISIONS.md` is the answer set.** Seventeen rounds and a hundred-odd answers,
the first thirty-eight on 2026-08-13, including the visual language (the reading room: warm
paper, serif for canon prose and entry titles, burnt umber accent). No gate is open: rounds
one to three answered questions asked before there was code, and every round since came from
using the deployed preview, which is why several answers reverse an earlier one. Two worth
knowing before you touch a component: the copilot's own hue was deleted in U10 after being
rejected on three surfaces, so unaccepted AI text is marked by shape rather than by colour,
and V1 gives every route one header band with three declared body widths. The register in
`docs/ux/assets/ux.js` carries the same answers so an artifact shows its decision at the top.

Before you build a screen, read the decision that gates it, and build what was decided
rather than what the artifact recommended, since those differ in three places. If a decision
has to move, say so on the issue instead of settling it by accident inside a component: that
is the whole reason this set exists. Changing a decision means editing `DECISIONS.md` and the
register together, and saying so on the issues it blocks.

**`docs/ux/REFERENCES.md` is the other input**, added 2026-08-22: eleven files under
`docs/ux/references/`, one per cluster of surfaces, each a list of named mechanics from real
products with the URL that was opened to check the claim, what to take, and what does not
survive our guardrails. It exists because seventeen rounds of looking at our own preview can
only ever improve what is already there. Nothing in it is a decision, and four of its
recommendations touch a decision on record, so it is read before a redesign and quoted in an
issue, never applied on its own authority.

## Design and UI

Follows the shared UI pipeline (`ui-brief-first`, `ui-design-tokens`, `ui-visual-review`;
`uishot` renders, `uislop` scores).

- `pnpm dev` (vite) needs Postgres and Qdrant up first: `pnpm db:up`
  (`docker/compose.dev.yml`), plus a `.env` (copy `.env.example`) with at least
  `DATABASE_URL` and `BETTER_AUTH_SECRET`, since `$lib/server/auth.ts` has no insecure
  fallback for the secret. No dev port is pinned; pick a free one per the worktree
  convention above.
- Screenshot `/dev/ui` first: it renders every shadcn-svelte component in both palettes
  side by side, needs no signed-in session or seeded universe, and is the lightest route
  once the db is up.
- Tokens: `apps/web/src/routes/layout.css`'s `@theme` block. This is the canonical file;
  the landing repo hand-copies it. A raw hex in a component is a violated rule
  (`I9 = C`, `docs/ux/DECISIONS.md`), not a style choice.
- `/dev/ui` (issue #147) is the `/design` gallery: a fresh repo without one should add
  exactly this, a dev-only route enumerating every component and state, not a product
  surface.
- Dark mode is real and whole-app (`G1 = B`), toggled via `[data-theme='dark']`, so a
  light/dark screenshot pair should differ, not come back identical. The theme is also a
  cookie (`canonry_theme`), which is what a signed-in shot needs when the account has chosen
  one: `uishot --theme dark` sets the media preference, and if the app has a stored choice
  the cookie is what actually decides, so pass both rather than wondering why the pixels
  came back light.
- **A native `<dialog>` is not centred in this app**, and the cause is not in our code:
  Tailwind 4's preflight sets `margin: 0` on `*`, `::before`, `::after` and `::backdrop`,
  which is the margin the user-agent stylesheet centres a modal `<dialog>` with. Three of
  them shipped pinned to the top-left corner before anybody looked (round thirteen R2,
  #377). Use the vendored `ui/dialog`, which is centred, traps focus, locks the scroll and
  animates on the motion tokens, and remember that its accessible name comes from
  `Dialog.Title`: a bare `<h3>` inside it leaves the dialog unnamed and axe says so.
- Motion is a system, and `prefers-reduced-motion` is honoured at the system level
  (`Q6`, #367): two duration tokens named by what they may move, two easings, one
  reduced-motion rule in `layout.css`, and `docs/ux/MOTION.md` as the four-rule pattern a
  component follows. A hardcoded `duration-200` is a violated rule the same way a raw hex
  is. Reduced motion means nothing travels, not that nothing happens, so verify it by
  emulating the preference (CDP `Emulation.setEmulatedMedia`) rather than by reading the
  media query, and expect the two runs to differ.

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
