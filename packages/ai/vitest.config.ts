import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		// This package's integration tests need real tables, so they create and migrate
		// their own database rather than depending on another package's run having done it.
		globalSetup: ['src/test-global-setup.ts']
	}
});
