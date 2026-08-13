// Shared by global-setup.ts and every test file, since vitest global setup runs in a
// process separate from test workers - mutating process.env there would not propagate.
export const TEST_DATABASE_URL =
	process.env.TEST_DATABASE_URL ?? 'postgres://canonry:canonry@127.0.0.1:55432/canonry_test';
