import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		// This package's integration tests need real tables (media_asset, image_model_config,
		// image_style) and a real Qdrant collection, so it creates and migrates its own
		// database rather than depending on another package's run having done it, exactly
		// like packages/ai and packages/import do.
		globalSetup: ['src/test-global-setup.ts']
	}
});
