// Public surface of @canonry/ai (issue #97). Everything a caller needs to
// route a model call through Cloudflare AI Gateway with DB-driven model
// selection and full cost accounting - nothing else is exported.

export {
	createGateway,
	readGatewayCredentials,
	replicateGatewayBaseUrl,
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

export { chargeFor, clearPriceCache, type PriceRow } from './prices.js';

export {
	recordCall,
	withUsage,
	computeCost,
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
