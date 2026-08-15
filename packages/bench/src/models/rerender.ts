/**
 * Re-renders a report from results already on disk, without spending anything.
 *
 *   pnpm --filter @canonry/bench rerender -- .data/models-premium-merged.json premium
 *
 * Exists because a sweep that ran out of gateway credit halfway has to be finished in a
 * second run, and the two result files then have to be read as one table. Merging them by
 * hand and re-reading the numbers is exactly the step where a report stops matching its
 * evidence.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadCatalogue } from './catalogue.js';
import { renderReport } from './report.js';
import type { CandidateResult } from './runner.js';
import type { BenchPurpose } from './candidates.js';

const [input, purposeArg] = process.argv.slice(2).filter((a) => a !== '--');
if (!input || !purposeArg) {
	throw new Error('usage: rerender <results.json> <purpose>');
}

const results = JSON.parse(readFileSync(input, 'utf8')) as CandidateResult[];
const purpose = purposeArg as BenchPurpose;
for (const result of results) result.purpose = purpose;

const catalogue = await loadCatalogue();
const report = renderReport(results, catalogue);
const out = input.replace(/\.json$/, '.md');
writeFileSync(out, report);
console.log(report);
console.log(`\nwritten to ${path.resolve(out)}`);
