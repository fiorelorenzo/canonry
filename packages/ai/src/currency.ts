/**
 * The one place a currency conversion rate lives (issue #132). Before this, a provider's
 * USD list price was converted to EUR once, at seed time, with the rate left in a
 * migration comment (0022, 0023, 0024, 0025, 0028) or not converted at all (0011, whose
 * `eurPerImage` column held Replicate's dollar figure unchanged - every `model_call.cost_eur`
 * an image generated was about 15% too high). Neither told a reader which rate produced a
 * stored number, or let it be corrected in one place when the rate moved.
 *
 * The fix: every price is stored in the currency the provider actually quotes it in
 * (`ModelParams.currency` / `ImageModelParams.currency`, @canonry/media), and crosses into
 * EUR here, at read time, through `computeCost` - the single place `model_call.cost_eur`
 * gets computed. A provider's price list is the durable fact; the exchange rate is not.
 */
export type Currency = 'EUR' | 'USD';

/** ECB reference rate this conversion was pinned to. Update this alongside USD_PER_EUR
 * when the rate is refreshed - nothing else reads a rate, so nothing else needs to change. */
export const FX_RATE_DATE = '2026-08-15';

/** USD per EUR, ECB reference rate on FX_RATE_DATE. */
const USD_PER_EUR = 1.1567;

/** Converts one price, stated in `currency`, to EUR at the single dated rate above. EUR
 * passes through unchanged - not a special case, just a rate of 1, so a caller never has
 * to branch on whether a price needs converting before calling this. */
export function toEur(amount: number, currency: Currency): number {
	if (currency === 'EUR') return amount;
	return amount / USD_PER_EUR;
}
