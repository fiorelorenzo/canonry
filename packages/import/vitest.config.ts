import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		// media-store.ts's tests need a real `media_asset` row (issue #40), so this package
		// creates and migrates its own test database before the run, exactly like
		// packages/ai and packages/media do.
		globalSetup: ['src/test-global-setup.ts']
	}
});
