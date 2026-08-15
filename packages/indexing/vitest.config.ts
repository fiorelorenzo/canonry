import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		// This package's tests need real data_source/data_source_exclusion tables, so it
		// creates and migrates its own database rather than depending on another
		// package's run having done it (packages/ai/src/test-global-setup.ts's pattern).
		globalSetup: ['src/test-global-setup.ts'],
		testTimeout: 30000,
		// Every test file here talks to the one real, shared, dev Qdrant instance (issue
		// #125's investigation): running this package's ~10 files' worth of
		// createCollection/deleteCollection churn concurrently can exhaust that
		// container's open-file limit under load from a busy dev box, surfacing as a
		// flaky "Internal Server Error" unrelated to any test's own assertions. Each file
		// already isolates itself with a per-file scratch collection prefix and its own
		// afterEach/afterAll cleanup, so running files sequentially costs wall-clock time,
		// not correctness, and trades a shared-infra flake for a slower, reliable run.
		fileParallelism: false
	}
});
