## cheap

Ranked by the weighted column, which weights each task by the calls it carries in a month rather than treating them as equal.

Monthly volume assumed for the cost and weighted columns: 214 import extraction, one call per document; 80 propagate.plan, one per save; 240 audit.flag, up to five pairs per save. Total 534 calls.

| model                                | rank  | audit | extract | mean  | weighted | fail % | median ms | in tok/call | out tok/call | EUR / month |
| ------------------------------------ | ----- | ----- | ------- | ----- | -------- | ------ | --------- | ----------- | ------------ | ----------- |
| google/gemini-3.1-flash-lite         | 0.874 | 1.000 | 0.839   | 0.904 | 0.917    | 0      | 6026      | 13205       | 312          | 1.74        |
| anthropic/claude-haiku-4.5 **(now)** | 0.848 | 0.900 | 0.825   | 0.858 | 0.862    | 0      | 11851     | 13397       | 718          | 7.84        |
| google/gemini-2.5-flash-lite         | 0.870 | 0.800 | 0.820   | 0.830 | 0.819    | 0      | 2580      | 6022        | 371          | 0.35        |
| mistral/mistral-small                | 0.873 | 0.850 | 0.738   | 0.821 | 0.809    | 0      | 3468      | 17998       | 531          | 0.90        |
| openai/gpt-4.1-nano                  | 0.829 | 0.700 | 0.829   | 0.786 | 0.771    | 0      | 5520      | 13354       | 282          | 0.67        |
| openai/gpt-5-nano                    | 0.864 | 0.700 | 0.742   | 0.769 | 0.741    | 0      | 23537     | 60666       | 6531         | 2.61        |
| openai/gpt-5-mini                    | 0.854 | 0.650 | 0.778   | 0.761 | 0.732    | 0      | 32593     | 36402       | 2285         | 6.31        |
| zai/glm-4.7-flash †                  | 0.838 | 0.600 | 0.648   | 0.695 | 0.655    | 0      | 8082      | 14977       | 621          | 0.60        |
| xai/grok-4.1-fast-non-reasoning      | 0.057 | 0.950 | 0.314   | 0.440 | 0.561    | 49     | 917       | 1422        | 17           | 0.14        |

† provider not in `KNOWN_PROVIDERS` (`packages/ai/src/composition.ts`). Adopting one means adding it there, with this measurement as the reason.

- `rank`: of the deterministic shortlist, keeps what a GM wants and drops the noise, and writes the plan in the reader locale
- `audit`: judges whether two statements from different entries disagree, against twenty labelled pairs, half of them deliberately compatible
- `extract`: runs the real import loop over one document and scores the entities and relations it proposed against the corpus gold
