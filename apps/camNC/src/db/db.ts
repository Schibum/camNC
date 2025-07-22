import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

let client: ReturnType<typeof drizzle<typeof schema>>;

export function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }

  if (!client) {
    client = drizzle(process.env.DATABASE_URL, { schema });
  }
  return client;
}
