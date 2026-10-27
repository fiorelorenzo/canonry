# Opening a pull request in this repository: what the kit's skill leaves to us

The workflow kit's `pr-creation` skill (`.agents/skills/pr-creation/SKILL.md`) is the
procedure; this file is the part only this repository does. Read the skill first, then
this. Where the two disagree, this file is the more specific one and wins.

## Before the PR

- Run `python3 .github/kit/bin/preflight` (`--list` first to see what your diff would
  trigger). Its manifest is `.github/preflight.json`; `--install-hook` wires it into
  `pre-push`. The expensive checks (full test suite against Postgres and Qdrant, image
  boot) run there, not in the PR's `ci`.
- Worktree setup, the shared dev services, test database suffixes and ports are in
  `AGENTS.md`, "Working in a worktree, next to other agents".

## Screenshots

For anything a person could see, one before-and-after pair per change, composed into a
single side-by-side image and attached with `gh pr edit <n> --attach`. The Screenshots
section is never deleted: if nothing visible changed, or a pair cannot be captured, say
so and why.

## Merge

`gh pr merge <n> --squash --delete-branch`, the only method the `require-pull-request`
ruleset allows. `allow_auto_merge` is on, so `gh pr merge <n> --auto --squash
--delete-branch` right after opening works as well. Either way, local `main` diverges on
every squash and has to be reset afterwards (`git checkout main && git reset --hard
origin/main`) in the checkout that has it.

## CI

The required check is the aggregate `ci` job; the `kit` job is one of its needs and
fails on a hand-edited kit file or a PR title or body that breaks `.github/workflow.json`.
After `gh pr edit`, re-run the failed `kit` job; it reads the PR from the API.
