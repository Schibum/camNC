import { defineConfig } from 'drizzle-kit';

// Generates SQL migrations for D1, applied with `wrangler d1 migrations apply`.
export default defineConfig({
  out: './migrations',
  schema: './worker/schema.ts',
  dialect: 'sqlite',
});
