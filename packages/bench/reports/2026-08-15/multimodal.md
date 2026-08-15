## multimodal

Ranked by the weighted column, which weights each task by the calls it carries in a month rather than treating them as equal.

Monthly volume assumed for the cost and weighted columns: 20 page_image, scanned pages in an import. Total 20 calls.

| model                           | page  | mean  | weighted | fail % | median ms | in tok/call | out tok/call | EUR / month |
| ------------------------------- | ----- | ----- | -------- | ------ | --------- | ----------- | ------------ | ----------- |
| anthropic/claude-sonnet-4.6     | 0.781 | 0.781 | 0.781    | 0      | 8559      | 1884        | 234          | 0.16        |
| google/gemini-3.1-flash-lite    | 0.756 | 0.756 | 0.756    | 0      | 1933      | 1333        | 259          | 0.01        |
| google/gemini-2.5-flash-lite    | 0.755 | 0.755 | 0.755    | 0      | 1691      | 1901        | 273          | 0.01        |
| alibaba/qwen3.5-flash           | 0.750 | 0.750 | 0.750    | 0      | 8826      | 2102        | 1122         | 0.01        |
| mistral/ministral-14b           | 0.726 | 0.726 | 0.726    | 0      | 4389      | 2484        | 300          | 0.01        |
| mistral/pixtral-12b             | 0.724 | 0.724 | 0.724    | 0      | 4396      | 2484        | 309          | 0.01        |
| anthropic/claude-haiku-4.5      | 0.720 | 0.720 | 0.720    | 0      | 4645      | 1883        | 237          | 0.05        |
| google/gemini-3-flash           | 0.720 | 0.720 | 0.720    | 0      | 19481     | 1333        | 3897         | 0.21        |
| openai/gpt-5-mini               | 0.713 | 0.713 | 0.713    | 0      | 17565     | 2381        | 1326         | 0.06        |
| openai/gpt-4.1-nano             | 0.690 | 0.690 | 0.690    | 0      | 2296      | 3829        | 162          | 0.01        |
| openai/gpt-5-nano               | 0.652 | 0.652 | 0.652    | 0      | 22878     | 2939        | 4264         | 0.03        |
| xai/grok-4.1-fast-non-reasoning | 0.217 | 0.217 | 0.217    | 0      | 1599      | 1135        | 128          | 0.01        |

- `page`: reads a scanned page with no text layer, scored on character accuracy against the page we printed and on the entities it found
