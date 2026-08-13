import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dialect: 'postgresql',
	schema: './src/schema/index.ts',
	out: './migrations',
	dbCredentials: {
		url: process.env.DATABASE_URL ?? 'postgres://canonry:canonry@127.0.0.1:55432/canonry'
	}
});
