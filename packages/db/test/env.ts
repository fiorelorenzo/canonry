// Shared by global-setup.ts and every test file, since vitest global setup runs in a
// process separate from test workers - mutating process.env there would not propagate.
// The database name carries a per-run suffix so two test runs in the same checkout never
// share one database. They would otherwise: the global setup drops and recreates it and
// terminates other backends on it, so a second concurrent run gets its connections killed
// mid-query, which reads like a postgres.js bug and is not one. CI sets TEST_DATABASE_URL
// explicitly and keeps a single deterministic name.
const suffix = process.env.TEST_DB_SUFFIX ?? 'local';

export const TEST_DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	`postgres://canonry:canonry@127.0.0.1:55432/canonry_test_${suffix}`;
