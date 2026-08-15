## premium

Ranked by the weighted column, which weights each task by the calls it carries in a month rather than treating them as equal.

Monthly volume assumed for the cost and weighted columns: 190 propagate.diff, ~7 entries on a third of plans; 40 ask.answer; 12 entry.complete. Total 242 calls.

| model                               | diff  | complete | ask   | mean  | weighted | fail % | median ms | in tok/call | out tok/call | EUR / month |
| ----------------------------------- | ----- | -------- | ----- | ----- | -------- | ------ | --------- | ----------- | ------------ | ----------- |
| openai/gpt-5.4                      | 0.958 | 0.704    | 0.778 | 0.813 | 0.916    | 0      | 2397      | 825         | 129          | 0.84        |
| xai/grok-4.3                        | 0.843 | 0.583    | 0.717 | 0.714 | 0.809    | 0      | 8351      | 1007        | 766          | 0.66        |
| openai/gpt-5-mini                   | 0.848 | 0.408    | 0.719 | 0.658 | 0.805    | 0      | 20693     | 825         | 1323         | 0.60        |
| google/gemini-3.1-pro-preview       | 0.830 | 0.317    | 0.760 | 0.635 | 0.793    | 0      | 18261     | 845         | 1892         | 5.10        |
| google/gemini-3-flash               | 0.822 | 0.242    | 0.626 | 0.563 | 0.761    | 0      | 13308     | 845         | 2966         | 1.95        |
| anthropic/claude-opus-4.8 **(now)** | 0.723 | 0.833    | 0.861 | 0.806 | 0.752    | 0      | 4312      | 1381        | 223          | 2.61        |
| openai/gpt-5.2                      | 0.601 | 0.642    | 0.767 | 0.670 | 0.630    | 0      | 3543      | 825         | 161          | 0.77        |
| anthropic/claude-sonnet-4.6         | 0.614 | 0.333    | 0.702 | 0.550 | 0.614    | 0      | 6144      | 1014        | 183          | 1.21        |
| google/gemini-2.5-flash             | 0.576 | 0.204    | 0.677 | 0.486 | 0.574    | 0      | 8404      | 812         | 1214         | 0.69        |
| anthropic/claude-haiku-4.5          | 0.326 | 0.608    | 0.637 | 0.524 | 0.391    | 0      | 3184      | 1013        | 160          | 0.38        |
| mistral/mistral-large-3             | 0.424 | 0.000    | 0.312 | 0.245 | 0.385    | 0      | 4343      | 821         | 164          | 0.14        |

- `diff`: writes the propagated update to one entry, judged for grounding, usefulness and craft
- `complete`: drafts the missing content of a thin entry, judged the same way
- `ask`: answers a question from retrieved canon, judged, with a hard zero for a claim the sources do not carry
