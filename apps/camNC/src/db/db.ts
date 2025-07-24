import { getAuth } from '@clerk/tanstack-react-start/server';
import { getWebRequest } from '@tanstack/react-start/server';
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

// Get clerk auth catch errors and return null instead.
export async function getSafeAuth() {
  try {
    return await getAuth(getWebRequest());
  } catch {
    return null;
  }
}

export { schema };
