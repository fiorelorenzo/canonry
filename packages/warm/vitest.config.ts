import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		// Integration tests need real tables (warm_artifact, session_context, entity,
		// relation, revision), so this package creates and migrates its own database
		// rather than depending on another package's run having done it already.
		globalSetup: ['src/test-global-setup.ts'],
		testTimeout: 20000
	}
});
