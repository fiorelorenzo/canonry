# The sample world, used by every UX artifact

Every mock in `docs/ux/` shows the same world with the same names and the same
numbers. A decision is easier to take when the only thing changing between two
options is the option itself, and a set of artifacts that invents fresh fiction on
each page makes the reader do work that has nothing to do with the decision.

Nothing here is a product requirement. It is fixture data.

## Universe

**Valdoria Reach**, homebrew, 214 entries, 38 images, image style modifier
`ink and wash, muted, cold light`. Second universe in the switcher: **Sword Coast
(ours)**, `derived` from the pre-indexed **Forgotten Realms**, 61 entries.

## Entries

| Entry | Type | What it is |
| --- | --- | --- |
| Aldric Vane | character | dismissed captain of the Valdoria Watch, now on the Ashen Ledger's payroll |
| Mother Sennah | character | keeps the Gilded Rat, was a field surgeon in the Sable Winter |
| Corvin Ashe | character | factor of the Ashen Ledger, holds most of the Lantern Quarter's debt |
| Iselde Wrenn | character | harbour magistrate, appointed Aldric and then broke him |
| Valdoria | place | free port city, six quarters, the Lantern Quarter is the poorest |
| The Gilded Rat | place | inn in the Lantern Quarter, aliases: Gilded Rat Tavern, Il Ratto Dorato |
| Cairnmouth | place | fishing town two days up the coast |
| The Sable Reach | place | the strait that froze in 1247 |
| The Ashen Ledger | faction | merchant bank that lends at knife point |
| The Valdoria Watch | faction | city watch, 340 sworn, badly paid |
| The Sable Winter | event | 1247, the strait froze, a third of Cairnmouth starved |

## Work

**Debts of Valdoria**, campaign, `status: running`.
Act 2 › Chapter 2 "The Lantern Quarter" › Scene 3 "A drink with the ex-captain",
which uses Aldric Vane, The Gilded Rat and Mother Sennah.

Current session: **session 7**, 2026-07-30.

## The edit that triggers propagation

The GM opens Aldric Vane and replaces

> Captain of the Valdoria Watch, forty sworn under him in the Lantern Quarter.

with

> Dismissed from the watch in the thaw after the Sable Winter, he now answers to
> the Ashen Ledger.

That sentence is the **evidence span** quoted by every proposal in the mocks.

## The impact set

Seven candidates, ordered by relevance, inside the cap of ten:

1. **The Valdoria Watch**, leadership paragraph still names him captain (relation `commands`)
2. **The Ashen Ledger**, roster has no Aldric (relation `employs`, missing)
3. **The Gilded Rat**, "drinks unbothered because the watch is his" no longer holds (mention)
4. **Iselde Wrenn**, relation `appointed` is stale, should be `dismissed`
5. **Valdoria**, the Watch section of the city entry names the captain
6. **Debts of Valdoria** › Act 2 › Ch 2 › Scene 3, the scene assumes a serving captain
7. **Mother Sennah**, relation `protects` reads the wrong way round now

## The audit flag

Two statements that disagree, shown with both spans:

- Aldric Vane: "Dismissed from the watch in the thaw after the Sable Winter."
- Cairnmouth: "Captain Vane led the watch through the second freeze, the winter after the thaw."

## The import run

Obsidian vault `valdoria-reach/`, 214 notes, 38 images, 1.4 MB zip, playbook
`obsidian@3`.

Estimate before the run: **about 214 documents, roughly 9 minutes, 0.42 EUR,
second in queue.**

Dry run of the second import: **142 unchanged, 19 to update, 4 conflicts to
review, 31 new.**

The one matching question: `the Gilded Rat` (existing) against `Il Ratto Dorato`
(incoming), similarity **0.86**, between the thresholds.

The field conflict: The Gilded Rat's `description`, edited by the GM on 2026-07-12
and changed at the source on 2026-07-28.

## Money

Included quota **2,400 of 5,000 credits** this month. Warm budget **180 of 600**,
counted separately. This import cost **0.42 EUR / 41 credits**. Portrait: 3
credits. Ambient pack: 3 credits per generated layer.

## Numbers that are real constraints, not fixture

Propagation cap ~10 entries per plan. Retrieval top-k 8, similarity threshold 0.5.
Media similarity cache at 0.94. Instant lane < 100 ms, fast lane 200-500 ms, slow
lane 3-10 s. Contradiction detection F1 around 52%, which is why nothing in any
mock says the canon is consistent.
