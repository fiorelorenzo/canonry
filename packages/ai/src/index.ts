// Public surface of @canonry/ai (issue #97). Everything a caller needs to
// route a model call through Cloudflare AI Gateway with DB-driven model
// selection and full cost accounting - nothing else is exported.

export {
	createGateway,
	readGatewayCredentials,
	MissingGatewayEnvError,
	type GatewayCredentials
} from './gateway.js';

export {
	resolveModel,
	clearModelCache,
	ModelNotConfiguredError,
	type ModelPurpose,
	type ModelParams,
	type ResolvedModel
} from './models.js';

export { toEur, FX_RATE_DATE, type Currency } from './currency.js';

export { chargeFor, clearPriceCache, type PriceRow } from './prices.js';

export {
	recordCall,
	withUsage,
	computeCost,
	normalizeUsage,
	type ModelCallInput,
	type ModelCallAgent,
	type UsageCounts,
	type WithUsageMeta,
	type WithUsageOptions
} from './usage.js';

export {
	generateImage,
	readReplicateApiToken,
	MissingReplicateEnvError,
	ReplicateRequestError,
	type GenerateImageInput,
	type ReplicatePrediction
} from './replicate.js';
export {
	withQuota,
	warmTierOf,
	warmSpendAllowed,
	WARM_TIER_RESERVE_FRACTION,
	getBalance,
	InsufficientCreditsError,
	WarmBudgetExhaustedError,
	type Balance,
	type WarmTier,
	type WarmSpendCheck,
	type WithQuotaMeta
} from './quota.js';
export {
	createLanguageModel,
	createEmbeddingModel,
	UnknownProviderError,
	isKnownProvider,
	KNOWN_PROVIDERS,
	type KnownProvider
} from './composition.js';
export {
	encryptApiKey,
	decryptApiKey,
	storeByoKey,
	resolveByoKey,
	lastFourOf,
	InvalidByoKeyEncryptionKeyError,
	InvalidByoKeyCiphertextError,
	type ByoKeyRow,
	type ByoKeyCredential,
	type EncryptedApiKey
} from './byo-key.js';
