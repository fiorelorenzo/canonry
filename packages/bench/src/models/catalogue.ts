/**
 * The gateway's own model list, which is the only honest source for what a model costs and
 * what it can do. Vercel AI Gateway serves it at `GET /v1/models` with per-token prices in
 * USD, so a price written into `model_config.params` is a copy of this at a moment in time
 * and not a number somebody remembered.
 *
 * Cached on disk because it is a few hundred kilobytes and a benchmark run reads it dozens
 * of times, never because it is expensive to fetch.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dataDir, loadEnv, requireEnv } from '../env.js';

export interface CatalogueModel {
	/** `provider/model`, the slug `@ai-sdk/gateway` addresses. */
	id: string;
	name: string;
	type: 'language' | 'embedding' | 'image' | 'video' | 'speech' | 'transcription' | string;
	contextWindow: number | null;
	maxOutputTokens: number | null;
	inputModalities: string[];
	outputModalities: string[];
	supportedParameters: string[];
	tags: string[];
	/** USD per token, exactly as served. Multiply by 1e6 for the per-million figure everyone
	 * quotes. Null when the gateway does not price that direction, which happens for a few
	 * free and preview models. */
	usdPerInputToken: number | null;
	usdPerOutputToken: number | null;
}

export interface Catalogue {
	fetchedAt: string;
	models: CatalogueModel[];
}

/**
 * ECB reference rate, 2026-08-15, the same day and the same rate migration
 * 0024_seed_text_models.sql used to convert Anthropic's list price into the euros
 * `model_config.params` stores. Kept as one constant so a re-run that lands different
 * euro figures does so because the rate moved, visibly, and not because two files
 * disagreed.
 */
export const USD_PER_EUR = 1.1567;

const GATEWAY_MODELS_URL = 'https://ai-gateway.vercel.sh/v1/models';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function cachePath(): string {
	return path.join(dataDir, 'gateway-models.json');
}

interface RawModel {
	id?: unknown;
	name?: unknown;
	type?: unknown;
	context_window?: unknown;
	max_tokens?: unknown;
	tags?: unknown;
	supported_parameters?: unknown;
	modalities?: { input?: unknown; output?: unknown };
	pricing?: { input?: unknown; output?: unknown };
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asPrice(value: unknown): number | null {
	if (typeof value === 'number') return value;
	if (typeof value !== 'string') return null;
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function normalise(raw: RawModel): CatalogueModel | null {
	if (typeof raw.id !== 'string' || typeof raw.type !== 'string') return null;
	return {
		id: raw.id,
		name: typeof raw.name === 'string' ? raw.name : raw.id,
		type: raw.type,
		contextWindow: typeof raw.context_window === 'number' ? raw.context_window : null,
		maxOutputTokens: typeof raw.max_tokens === 'number' ? raw.max_tokens : null,
		inputModalities: asStringArray(raw.modalities?.input),
		outputModalities: asStringArray(raw.modalities?.output),
		supportedParameters: asStringArray(raw.supported_parameters),
		tags: asStringArray(raw.tags),
		usdPerInputToken: asPrice(raw.pricing?.input),
		usdPerOutputToken: asPrice(raw.pricing?.output)
	};
}

export async function loadCatalogue(options: { refresh?: boolean } = {}): Promise<Catalogue> {
	loadEnv();
	const file = cachePath();
	if (!options.refresh) {
		try {
			const age = Date.now() - statSync(file).mtimeMs;
			if (age < CACHE_MAX_AGE_MS) return JSON.parse(readFileSync(file, 'utf8')) as Catalogue;
		} catch {
			// No cache yet, or an unreadable one. Fetch.
		}
	}

	const response = await fetch(GATEWAY_MODELS_URL, {
		headers: { Authorization: `Bearer ${requireEnv('AI_GATEWAY_API_KEY')}` }
	});
	if (!response.ok) {
		throw new Error(`gateway model list refused: ${response.status} ${response.statusText}`);
	}
	const body = (await response.json()) as { data?: unknown };
	const rows = Array.isArray(body.data) ? body.data : [];
	const models: CatalogueModel[] = [];
	for (const row of rows) {
		const model = normalise(row as RawModel);
		if (model) models.push(model);
	}
	models.sort((a, b) => a.id.localeCompare(b.id));

	const catalogue: Catalogue = { fetchedAt: new Date().toISOString(), models };
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(catalogue, null, '\t'));
	return catalogue;
}

export interface ModelPrices {
	usdPerInputMTok: number;
	usdPerOutputMTok: number;
	eurPerInputMTok: number;
	eurPerOutputMTok: number;
}

/**
 * Prices for one slug, in both currencies, rounded the way `model_config.params` stores
 * them. Throws on an unpriced model rather than defaulting to zero: a benchmark whose cost
 * column silently reads 0.00 for one row is worse than one that stops.
 */
export function pricesFor(catalogue: Catalogue, slug: string): ModelPrices {
	const model = catalogue.models.find((m) => m.id === slug);
	if (!model) throw new Error(`${slug} is not in the gateway catalogue`);
	if (model.usdPerInputToken === null || model.usdPerOutputToken === null) {
		throw new Error(`${slug} carries no price in the gateway catalogue`);
	}
	const usdPerInputMTok = model.usdPerInputToken * 1e6;
	const usdPerOutputMTok = model.usdPerOutputToken * 1e6;
	return {
		usdPerInputMTok,
		usdPerOutputMTok,
		eurPerInputMTok: Number((usdPerInputMTok / USD_PER_EUR).toFixed(4)),
		eurPerOutputMTok: Number((usdPerOutputMTok / USD_PER_EUR).toFixed(4))
	};
}

export function findModel(catalogue: Catalogue, slug: string): CatalogueModel {
	const model = catalogue.models.find((m) => m.id === slug);
	if (!model) throw new Error(`${slug} is not in the gateway catalogue`);
	return model;
}
