# CLAUDE.md

@AGENTS.md

Everything in `AGENTS.md` applies. What follows is specific to Claude Code.

## Before touching anything

- Read `SPEC.md` in full once per session. It is the contract; the guardrails in
  §3 are not negotiable and several of them are easy to violate by accident.
- Check the board before starting: `gh project item-list 9 --owner fiorelorenzo`.
  Move the issue to `In Progress` before writing code, not after.

## Hard rules

- **Never write to canon without an accept path.** If you are adding a code path
  that mutates `entity`, `relation` or `fact` outside an accepted proposal, stop:
  you are almost certainly implementing something the spec forbids.
- **Never let a protocol or provider type escape `packages/import`.** That seam is
  what makes the Spole migration a dependency change instead of a rewrite.
- **Never claim a deploy works because a request returned 200.** Compare the served
  version against the built artifact; prodbox has served a stale build behind a
  green curl before.
- **Never add an "accept all" affordance**, however convenient it looks in a demo.

## Context discipline

The spec is long. Read the sections you need in full rather than grepping for
keywords: the constraints usually live in the paragraph after the one that looks
relevant. When a section contradicts what you remember, the file wins.
