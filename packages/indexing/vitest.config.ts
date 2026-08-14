import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		// This package's tests need real data_source/data_source_exclusion tables, so it
		// creates and migrates its own database rather than depending on another
		// package's run having done it (packages/ai/src/test-global-setup.ts's pattern).
		globalSetup: ['src/test-global-setup.ts'],
		testTimeout: 30000
	}
});
