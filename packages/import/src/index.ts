// Public surface of @canonry/import (SPEC.md §11.2, §6). The driver seam, the bounded
// loop's gateway implementation, playbook loading, and the injected filesystem/image
// interfaces - nothing else is exported.

export type {
	ImportDriver,
	ImportJob,
	JobBudget,
	JobDocument,
	JobEvent,
	JobStream,
	DocumentStatus,
	EntityProposalPayload,
	RelationProposalPayload
} from './driver.js';

export {
	GatewayDriver,
	type GatewayWrapper,
	type ImportModel,
	type ModelSelector,
	type BudgetTracker
} from './gateway-driver.js';

export {
	loadPlaybook,
	loadPlaybookFile,
	loadBuiltinPlaybook,
	playbookVersion,
	PlaybookParseError,
	PlaybookValidationError,
	type LoadedPlaybook,
	type LoadPlaybookOptions,
	type ImportModelPurpose
} from './playbook.js';

export { IMPORT_TOOL_NAMES, isImportToolName, type ImportToolName } from './tool-names.js';

export {
	createImportTools,
	createDocumentRunContext,
	type DocumentRunContext,
	type CreateImportToolsDeps
} from './tools.js';

export {
	InMemorySourceReader,
	SourceNotFoundError,
	type SourceReader,
	type SourceEntry,
	type SourceReadResult,
	type RenderedPage,
	type BinaryAsset
} from './sources.js';

export { InMemoryImageStore, type ImageStore, type StoredImage } from './images.js';

export {
	createLoopLogger,
	loopLogger,
	ForbiddenLoopLogFieldError,
	type LoopLogger,
	type LoopLogFields,
	type LoopLogEvent,
	type LoopLogStatus,
	type LoopLogSink
} from './logging.js';
