// import 'dotenv/config';
import dotenvx from '@dotenvx/dotenvx';
dotenvx.config({ path: ['.env.local', '.env'], ignore: ['MISSING_ENV_FILE'] });

import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
