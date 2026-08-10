# Canonry

**A wiki for your game world where an AI copilot works in every flow, and never
writes anything you did not accept.**

The copilot is called the **Loremaster**. It answers questions about your canon,
completes half-written entries, flags what stops adding up, and, the part nobody
else does, when you change one entry it tells you which other entries that change
touches and drafts each update for you to accept or throw away, one by one.

One line: the coding copilot's plan-diff-accept loop, applied to a game world's
canon.

## Status

**Nothing is built yet.** This repository currently holds the specification and the
roadmap. If you are looking for something to run, come back later.

- [`SPEC.md`](SPEC.md): what Canonry is, in full. Domain model, the Loremaster,
  ingestion, table mode, architecture, metrics, pricing shape.
- The GitHub Project: where the work stands. It is the source of truth for state.

## What it does, when it exists

- **A typed graph, not a pile of pages.** Characters, places, factions, items,
  events and sessions, with relations that are typed and reflected automatically:
  say Aldric governs Valdoria once, and Valdoria shows "governed by Aldric" without
  you writing it there.
- **Propagation you can read before it happens.** Change an entry and Canonry shows
  which entries that touches and why, then drafts each update. Every change needs
  an explicit accept, one entry at a time.
- **Import from where your world already lives.** Obsidian, Kanka, World Anvil,
  OneNote, PDF, DOCX, and anything else through a generic path. A second import
  updates what changed and never duplicates what you already have.
- **A table mode that does not make you wait.** Say where the party is, and the
  people, places and sounds of that location are already there.
- **A players' wiki that only shows what they discovered.** No per-entry curation.

## Principles

These are constraints, not slogans. An implementation that breaks one is wrong even
if its tests pass.

1. **The AI proposes, the human disposes.** No automatic writes, ever, and no
   "accept all" default.
2. **AI text is visually distinct** until accepted, and stays tracked afterwards.
3. **Every proposal shows its evidence**: which entry, which sentence.
4. **The AI switches off completely**, and what remains is a good wiki.
5. **Your data leaves when you want**: Markdown export from the first release.
6. **Nothing unreviewed is ever published to your players.**
7. **Consistency is never promised.** Canonry says "here is what does not add up";
   it never certifies that your canon is coherent, because no honest system can.

## Licence

[AGPL-3.0](LICENSE). Contributions require the [CLA](CLA.md).
