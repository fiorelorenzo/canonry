# Surface inventory

The inventory of every visible surface the product has to grow, and the issues and
decisions that gate it. Most engine issues (schema, matching, the import loop, indexing)
appear nowhere in it, on purpose: they can start without a UX gate. Rescued from
`docs/ux/index.html`, deleted 2026-08-23 (readable in git history at `c84c8f8`), because
`AGENTS.md` still points a fresh agent here for the inventory. `Gated by` names decision
IDs; every one of them resolves to a row and a prose section in `DECISIONS.md`.

## Shell and foundations

| Surface | What it is | Built by | Gated by |
| --- | --- | --- | --- |
| App shell | Sidebar, top bar, universe switcher, the frame every other screen sits in | [#104](https://github.com/fiorelorenzo/canonry/issues/104) [#141](https://github.com/fiorelorenzo/canonry/issues/141) [#148](https://github.com/fiorelorenzo/canonry/issues/148) | A1 A2 · G1 G2 · I3 I10 |
| Command palette | Search, jump, run an action, possibly ask a question | [#149](https://github.com/fiorelorenzo/canonry/issues/149) | A3 · G3 |
| The control layer | Buttons, dialogs, badges, and the ten places that still open the browser's own select | [#147](https://github.com/fiorelorenzo/canonry/issues/147) [#155](https://github.com/fiorelorenzo/canonry/issues/155) [#286](https://github.com/fiorelorenzo/canonry/issues/286) | I9 · G1 G2 · O4 |
| The copilot's front door | How a question gets asked from wherever the GM already is, and what remembers the answer | [#285](https://github.com/fiorelorenzo/canonry/issues/285) [#290](https://github.com/fiorelorenzo/canonry/issues/290) | O3 · A3 C8 G5 |
| Auth screens | Signup, login, social login, the first screen anybody sees | [#86](https://github.com/fiorelorenzo/canonry/issues/86) [#139](https://github.com/fiorelorenzo/canonry/issues/139) | A1 D7 · I1 I2 |
| Settings | Account, universe, AI on and off, keys, style, export | [#107](https://github.com/fiorelorenzo/canonry/issues/107) [#143](https://github.com/fiorelorenzo/canonry/issues/143) [#144](https://github.com/fiorelorenzo/canonry/issues/144) | C10 F3 · H1 · I5 I6 |
| Empty states | New universe, no entries, no proposals, nothing revealed yet | [#146](https://github.com/fiorelorenzo/canonry/issues/146) | A2 D7 · I8 |
| User profiles | A handle, and the worlds a GM has chosen to publish, nothing else by default | [#158](https://github.com/fiorelorenzo/canonry/issues/158) | J1 |

## Canon

| Surface | What it is | Built by | Gated by |
| --- | --- | --- | --- |
| Entry read view | The most visited screen in the product | [#15](https://github.com/fiorelorenzo/canonry/issues/15) [#17](https://github.com/fiorelorenzo/canonry/issues/17) [#284](https://github.com/fiorelorenzo/canonry/issues/284) | B1 B4 · G2 · O2 |
| Entry editor | Markdown, mentions, sections, saving that triggers propagation | [#105](https://github.com/fiorelorenzo/canonry/issues/105) | B2 · G4 |
| Entry cover | The one image that is the entry's face, which the schema has no column for | [#284](https://github.com/fiorelorenzo/canonry/issues/284) | O2 · F1 G11 |
| World home | What a GM sees on opening a world, as opposed to the list of its entries | [#283](https://github.com/fiorelorenzo/canonry/issues/283) | O1 · I7 |
| Entry browser | List and filter 214 entries by type, alias, recency | [#145](https://github.com/fiorelorenzo/canonry/issues/145) [#283](https://github.com/fiorelorenzo/canonry/issues/283) | A2 B1 · I7 · O1 |
| Relation editing | One row, two labels, cardinality, allowed types | [#16](https://github.com/fiorelorenzo/canonry/issues/16) | B3 |
| Relation catalogue | Every type a universe can use, shipped and its own, with a real usage count; rename, merge, widen | [#192](https://github.com/fiorelorenzo/canonry/issues/192) | K1 |
| Type and alias confirmation | Inferred, confirmed with one click, never a form | [#15](https://github.com/fiorelorenzo/canonry/issues/15) | B3 |
| Facts and spans | The extracted layer, and how much of it the GM ever sees | [#17](https://github.com/fiorelorenzo/canonry/issues/17) | B4 |
| Revision history | Human against accepted AI, per entry, forever | [#18](https://github.com/fiorelorenzo/canonry/issues/18) | B4 |
| Derived universe precedence | Your canon wins, and a superseded source page disappears | [#19](https://github.com/fiorelorenzo/canonry/issues/19) | A2 |
| Works and scenes | Ordered tree, scene editor, which entries a scene uses | [#20](https://github.com/fiorelorenzo/canonry/issues/20) | B5 |
| Media on an entry | Portraits, generated badge, private by default | [#66](https://github.com/fiorelorenzo/canonry/issues/66) [#71](https://github.com/fiorelorenzo/canonry/issues/71) | F1 |
| Export | Markdown out, from day one, because of Realm Works | [#21](https://github.com/fiorelorenzo/canonry/issues/21) | F4 · G10 |

## The copilot loop, which is the product

| Surface | What it is | Built by | Gated by |
| --- | --- | --- | --- |
| AI text marking | Distinct before accept, tracked after | [#106](https://github.com/fiorelorenzo/canonry/issues/106) | C1 |
| Proposal routing | Where a background proposal shows up and how you learn it exists | [#47](https://github.com/fiorelorenzo/canonry/issues/47) [#51](https://github.com/fiorelorenzo/canonry/issues/51) | C2 |
| Propagation plan | Four entries touched, here is why, drop any before diffs are written | [#50](https://github.com/fiorelorenzo/canonry/issues/50) | C3 |
| Per-entry diff | Prose diff, field diff, relation diff | [#51](https://github.com/fiorelorenzo/canonry/issues/51) [#48](https://github.com/fiorelorenzo/canonry/issues/48) | C4 · G2 |
| Evidence | Which entry, which sentence, and never a bare score | [#47](https://github.com/fiorelorenzo/canonry/issues/47) | C5 |
| Accept and reject | Per entry, fast, reversible, no accept-all | [#51](https://github.com/fiorelorenzo/canonry/issues/51) | C6 · G3 |
| Reject reason | One word, feeding the ranking | [#56](https://github.com/fiorelorenzo/canonry/issues/56) | C7 |
| Ask | Streaming answer, listed sources, five detail levels | [#53](https://github.com/fiorelorenzo/canonry/issues/53) [#60](https://github.com/fiorelorenzo/canonry/issues/60) [#285](https://github.com/fiorelorenzo/canonry/issues/285) | C8 A3 · G5 · O3 |
| Complete a thin entry | Proposed fields on something half written | [#54](https://github.com/fiorelorenzo/canonry/issues/54) | C1 C6 |
| Audit flags | Two statements that disagree, and wording that never certifies | [#55](https://github.com/fiorelorenzo/canonry/issues/55) | C9 |
| AI off | The whole copilot gone, and a wiki that still earns its price | [#107](https://github.com/fiorelorenzo/canonry/issues/107) | C10 · G9 H1 |

## Import, which is where a new user starts

| Surface | What it is | Built by | Gated by |
| --- | --- | --- | --- |
| Source selection | Upload, detect, or choose one of seven playbooks | [#41](https://github.com/fiorelorenzo/canonry/issues/41) [#43](https://github.com/fiorelorenzo/canonry/issues/43) [#44](https://github.com/fiorelorenzo/canonry/issues/44) [#45](https://github.com/fiorelorenzo/canonry/issues/45) | D1 |
| Estimate and consent | Size, time, cost and queue position before anything runs | [#30](https://github.com/fiorelorenzo/canonry/issues/30) | D2 F2 |
| Run, cancel, resume | Nine minutes of somebody's attention, or none | [#26](https://github.com/fiorelorenzo/canonry/issues/26) [#27](https://github.com/fiorelorenzo/canonry/issues/27) | D2 |
| Dry run plan | 142 unchanged, 19 to update, 4 conflicts, 31 new | [#37](https://github.com/fiorelorenzo/canonry/issues/37) [#36](https://github.com/fiorelorenzo/canonry/issues/36) | D3 · G6 |
| Batch review | Two hundred proposals, guardrail 1 intact | [#42](https://github.com/fiorelorenzo/canonry/issues/42) | D4 C6 · G6 |
| Field conflict | Your edit against the source's, never overwritten | [#37](https://github.com/fiorelorenzo/canonry/issues/37) | D5 |
| The matching question | Same inn or new inn, asked once | [#37](https://github.com/fiorelorenzo/canonry/issues/37) | D6 |
| Onboarding | Signup to first accepted proposal, measured in minutes | [#108](https://github.com/fiorelorenzo/canonry/issues/108) | D7 |
| Import guides | How to export from each source, including the Mac OneNote caveat | [#110](https://github.com/fiorelorenzo/canonry/issues/110) | D1 |

## Table and players

| Surface | What it is | Built by | Gated by |
| --- | --- | --- | --- |
| Table mode shell | A mode, a screen or a layer, and how context is declared | [#72](https://github.com/fiorelorenzo/canonry/issues/72) [#73](https://github.com/fiorelorenzo/canonry/issues/73) | E1 · G1 G8 |
| Freshness and warming | Instant, fast, slow, and the budget running out mid-session | [#77](https://github.com/fiorelorenzo/canonry/issues/77) [#78](https://github.com/fiorelorenzo/canonry/issues/78) [#79](https://github.com/fiorelorenzo/canonry/issues/79) | E2 |
| Quick actions | Create an NPC here, mark as revealed, set the mood | [#74](https://github.com/fiorelorenzo/canonry/issues/74) [#80](https://github.com/fiorelorenzo/canonry/issues/80) | E3 |
| Who is this | Instant search with a player looking at you | [#75](https://github.com/fiorelorenzo/canonry/issues/75) | A3 E1 |
| Phone layout | One hand, a lit table, ten seconds | [#81](https://github.com/fiorelorenzo/canonry/issues/81) | E4 · G1 |
| Audio controls | Layers, crossfade, mood chosen by the GM | [#68](https://github.com/fiorelorenzo/canonry/issues/68) [#69](https://github.com/fiorelorenzo/canonry/issues/69) | E2 E3 |
| Reveal | What the party learned, tied to the session it happened in | [#82](https://github.com/fiorelorenzo/canonry/issues/82) | E5 · G7 |
| Secrets | Hidden inside public entries, and a preview of what players see | [#84](https://github.com/fiorelorenzo/canonry/issues/84) | E6 |
| Players wiki | Read-only, filtered by revelation, zero configuration | [#83](https://github.com/fiorelorenzo/canonry/issues/83) [#85](https://github.com/fiorelorenzo/canonry/issues/85) | E7 · G7 |

## Media, money and the public site

| Surface | What it is | Built by | Gated by |
| --- | --- | --- | --- |
| Image generation | One image or four variants, a badge, a style | [#66](https://github.com/fiorelorenzo/canonry/issues/66) [#65](https://github.com/fiorelorenzo/canonry/issues/65) [#64](https://github.com/fiorelorenzo/canonry/issues/64) | F1 · G11 |
| Quota and cost | Credits or currency, and the warm budget on its own line | [#88](https://github.com/fiorelorenzo/canonry/issues/88) [#89](https://github.com/fiorelorenzo/canonry/issues/89) [#150](https://github.com/fiorelorenzo/canonry/issues/150) | F2 · G9 G11 H1 |
| Subscription and checkout | The page where somebody pays | [#91](https://github.com/fiorelorenzo/canonry/issues/91) [#7](https://github.com/fiorelorenzo/canonry/issues/7) | F2 |
| BYO key and privacy | Which provider sees what, in plain words | [#90](https://github.com/fiorelorenzo/canonry/issues/90) [#109](https://github.com/fiorelorenzo/canonry/issues/109) | F3 |
| Metrics | Accept rate and time to first value, the two that decide this | [#100](https://github.com/fiorelorenzo/canonry/issues/100) [#101](https://github.com/fiorelorenzo/canonry/issues/101) [#103](https://github.com/fiorelorenzo/canonry/issues/103) [#102](https://github.com/fiorelorenzo/canonry/issues/102) | F5 |
| Landing and demo | The propagation loop shown without overpromising. Ships from `canonry-landing`, its own repository and its own deployment, not from this one | another repo · [#129](https://github.com/fiorelorenzo/canonry/issues/129) | F6 · G10 |
