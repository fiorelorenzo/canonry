/**
 * How much money is left on the gateway.
 *
 * Worth its own file because of how the first long run ended: the balance hit zero
 * partway through the premium sweep, every subsequent call came back as a 402 that the AI
 * SDK surfaces as `GatewayInternalServerError`, and the report duly recorded five
 * candidates scoring 0.000 with a 100 per cent failure rate. That table looked exactly
 * like five models that cannot do the job. A benchmark that cannot tell "this model is
 * bad" from "the card was declined" is worse than no benchmark, so the runner now checks
 * before each candidate and stops with a sentence naming the real reason.
 */
import { loadEnv, requireEnv } from '../env.js';

export interface GatewayBalance {
	balanceUsd: number;
	totalUsedUsd: number;
}

export class GatewayOutOfCreditError extends Error {
	constructor(readonly balance: GatewayBalance) {
		super(
			`the AI Gateway balance is ${balance.balanceUsd.toFixed(2)} USD after ` +
				`${balance.totalUsedUsd.toFixed(2)} USD of use. Every further call returns 402, which ` +
				'the SDK reports as GatewayInternalServerError, so the run stops here rather than ' +
				'recording a column of zeroes that reads like a model failure. Top up and re-run.'
		);
		this.name = 'GatewayOutOfCreditError';
	}
}

export async function gatewayBalance(): Promise<GatewayBalance> {
	loadEnv();
	const response = await fetch('https://ai-gateway.vercel.sh/v1/credits', {
		headers: { Authorization: `Bearer ${requireEnv('AI_GATEWAY_API_KEY')}` }
	});
	if (!response.ok) {
		throw new Error(`gateway credit check refused: ${response.status} ${response.statusText}`);
	}
	const body = (await response.json()) as { balance?: unknown; total_used?: unknown };
	return {
		balanceUsd: Number(body.balance ?? 0),
		totalUsedUsd: Number(body.total_used ?? 0)
	};
}

/** Refuses to start another candidate on a balance that cannot pay for it. The floor is
 * not zero: a sweep of one candidate over three tasks has cost between 0.20 and 1.50 USD
 * in practice, so stopping at a dollar leaves the last candidate's numbers trustworthy
 * rather than half-paid-for. */
export async function assertCreditAvailable(floorUsd = 1): Promise<GatewayBalance> {
	const balance = await gatewayBalance();
	if (balance.balanceUsd < floorUsd) throw new GatewayOutOfCreditError(balance);
	return balance;
}
